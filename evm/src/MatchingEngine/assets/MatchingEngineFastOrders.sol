// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWormhole} from "wormhole-solidity-sdk/interfaces/IWormhole.sol";
import {CctpMessage, RouterEndpoint} from "src/interfaces/IMatchingEngineTypes.sol";
import {IMatchingEngineFastOrders} from "src/interfaces/IMatchingEngineFastOrders.sol";
import {BytesParsing} from "wormhole-solidity-sdk/libraries/BytesParsing.sol";
import {Messages} from "src/shared/Messages.sol";
import {Utils} from "src/shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {
    getRouterEndpointState,
    LiveAuctionData,
    getLiveAuctionInfo,
    AuctionStatus,
    getFastFillsState,
    FastFills,
    getCircleDomainsState
} from "./Storage.sol";

abstract contract MatchingEngineFastOrders is IMatchingEngineFastOrders, State {
    using BytesParsing for bytes;
    using Utils for address;
    using Messages for *;

    event AuctionStarted(
        bytes32 indexed auctionId, uint64 transferAmount, uint64 startingBid, address bidder
    );
    event NewBid(bytes32 indexed auctionId, uint64 newBid, uint64 oldBid, address bidder);

    /// @inheritdoc IMatchingEngineFastOrders
    function placeInitialBid(bytes calldata fastTransferVaa, uint64 feeBid) external {
        IWormhole.VM memory vaa = _verifyWormholeMessage(fastTransferVaa);

        Messages.FastMarketOrder memory order = vaa.payload.decodeFastMarketOrder();

        if (uint32(block.timestamp) >= order.deadline && order.deadline != 0) {
            revert ErrDeadlineExceeded();
        }
        if (feeBid > order.maxFee) {
            revert ErrBidPriceTooHigh(feeBid, order.maxFee);
        }

        /**
         * SECURITY: This is the only time the router path is verified throughout the
         * life of an auction. The hash of the vaa is stored as the auction ID,
         * so we can trust the router path of a verified VAA with a corresponding
         * hash.
         */
        _verifyRouterPath(vaa.emitterChainId, vaa.emitterAddress, order.targetChain);

        // Confirm the auction hasn't started yet.
        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vaa.hash];
        if (auction.status != AuctionStatus.None) {
            // Call `improveBid` so that relayers racing to start the auction
            // do not revert and waste gas.
            _improveBid(vaa.hash, auction, feeBid);

            return;
        }

        /**
         * Transfer the funds to the contract. The amount that is transfered includes:
         * - The amount being transferred.
         * - A "security deposit" to entice the relayer to initiate the transfer in a timely manner.
         *
         * - NOTE we do this before setting state in case the transfer fails.
         */
        SafeERC20.safeTransferFrom(_token, msg.sender, address(this), order.amountIn + order.maxFee);

        // Set the live auction data.
        auction.status = AuctionStatus.Active;
        auction.startBlock = uint64(block.number);
        auction.highestBidder = msg.sender;
        auction.initialBidder = msg.sender;
        auction.amount = order.amountIn;
        auction.securityDeposit = order.maxFee;
        auction.bidPrice = feeBid;

        emit AuctionStarted(vaa.hash, order.amountIn, feeBid, msg.sender);
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function improveBid(bytes32 auctionId, uint64 feeBid) public {
        // Fetch auction information, if it exists.
        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[auctionId];

        _improveBid(auctionId, auction, feeBid);
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function executeFastOrder(bytes calldata fastTransferVaa)
        external
        payable
        returns (uint64 sequence)
    {
        IWormhole.VM memory vaa = _verifyWormholeMessage(fastTransferVaa);

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vaa.hash];

        if (auction.status != AuctionStatus.Active) {
            revert ErrAuctionNotActive(vaa.hash);
        }

        uint64 blocksElapsed = uint64(block.number) - auction.startBlock;
        if (blocksElapsed <= _auctionDuration) {
            revert ErrAuctionPeriodNotComplete();
        }

        Messages.FastMarketOrder memory order = vaa.payload.decodeFastMarketOrder();

        if (blocksElapsed > _auctionGracePeriod) {
            (uint64 penalty, uint64 userReward) =
                calculateDynamicPenalty(auction.securityDeposit, blocksElapsed);

            /**
             * Give the penalty amount to the liquidator and return the remaining
             * security deposit to the highest bidder. The penalty should always be
             * nonzero in this branch. Also, pay the user a `reward` for having to
             * wait longer than the auction grace period.
             */
            SafeERC20.safeTransfer(_token, msg.sender, penalty);
            SafeERC20.safeTransfer(
                _token,
                auction.highestBidder,
                auction.bidPrice + auction.securityDeposit - (penalty + userReward)
            );

            // Transfer funds to the recipient on the target chain.
            sequence = _handleCctpTransfer(
                auction.amount - auction.bidPrice - order.initAuctionFee + userReward,
                vaa.emitterChainId,
                order
            );
        } else {
            // Return the security deposit and the fee to the highest bidder.
            SafeERC20.safeTransfer(
                _token, auction.highestBidder, auction.bidPrice + auction.securityDeposit
            );

            // Transfer funds to the recipient on the target chain.
            sequence = _handleCctpTransfer(
                auction.amount - auction.bidPrice - order.initAuctionFee, vaa.emitterChainId, order
            );
        }

        // Pay the auction initiator their fee.
        SafeERC20.safeTransfer(_token, auction.initialBidder, order.initAuctionFee);

        // Set the auction as completed.
        auction.status = AuctionStatus.Completed;
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function executeSlowOrderAndRedeem(bytes calldata fastTransferVaa, CctpMessage calldata params)
        external
        payable
        returns (uint64 sequence)
    {
        IWormhole.VM memory vaa = _verifyWormholeMessage(fastTransferVaa);

        // Redeem the slow CCTP transfer.
        (IWormhole.VM memory cctpVaa,,,,, bytes memory payload) = verifyVaaAndMint(
            params.circleBridgeMessage, params.circleAttestation, params.encodedWormholeMessage
        );

        Messages.FastMarketOrder memory order = vaa.payload.decodeFastMarketOrder();

        // Confirm that the fast transfer VAA is associated with the slow transfer VAA.
        if (
            vaa.emitterChainId != cctpVaa.emitterChainId
                || vaa.emitterAddress != cctpVaa.emitterAddress || vaa.sequence != cctpVaa.sequence + 1
                || vaa.timestamp != cctpVaa.timestamp
        ) {
            revert ErrVaaMismatch();
        }

        // Parse the `maxFee` from the slow VAA.
        uint64 baseFee = payload.decodeSlowOrderResponse().baseFee;

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vaa.hash];

        if (auction.status == AuctionStatus.None) {
            // SECURITY: We need to verify the router path, since an auction was never created
            // and this check is done in `placeInitialBid`.
            _verifyRouterPath(cctpVaa.emitterChainId, cctpVaa.emitterAddress, order.targetChain);

            sequence = _handleCctpTransfer(order.amountIn - baseFee, cctpVaa.emitterChainId, order);

            /**
             * Pay the `feeRecipient` the `baseFee`. This ensures that the protocol relayer
             * is paid for relaying slow VAAs that do not have an associated auction.
             * This prevents the protocol relayer from any MEV attacks.
             */
            SafeERC20.safeTransfer(_token, feeRecipient(), baseFee);

            /*
             * SECURITY: this is a necessary security check. This will prevent a relayer from
             * starting an auction with the fast transfer VAA, even though the slow
             * relayer already delivered the slow VAA. Not setting this could lead
             * to trapped funds (which would require an upgrade to fix).
             */
            auction.status = AuctionStatus.Completed;
        } else if (auction.status == AuctionStatus.Active) {
            /**
             * This means the slow message beat the fast message. We need to refund
             * the bidder and (potentially) take a penalty for not fulfilling their
             * obligation. The `penalty` CAN be zero in this case, since the auction
             * grace period might not have ended yet.
             */
            (uint64 penalty, uint64 userReward) = calculateDynamicPenalty(
                auction.securityDeposit, uint64(block.number) - auction.startBlock
            );

            // Transfer the penalty amount to the caller. The caller also earns the base
            // fee for relaying the slow VAA.
            SafeERC20.safeTransfer(_token, msg.sender, penalty + baseFee);
            SafeERC20.safeTransfer(
                _token,
                auction.highestBidder,
                auction.amount + auction.securityDeposit - (penalty + userReward)
            );

            sequence = _handleCctpTransfer(
                auction.amount - baseFee + userReward, cctpVaa.emitterChainId, order
            );

            // Everyone's whole, set the auction as completed.
            auction.status = AuctionStatus.Completed;
        } else if (auction.status == AuctionStatus.Completed) {
            // Transfer the funds back to the highest bidder.
            SafeERC20.safeTransfer(_token, auction.highestBidder, auction.amount);
        } else {
            revert ErrInvalidAuctionStatus();
        }
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function redeemFastFill(bytes calldata fastFillVaa)
        external
        returns (Messages.FastFill memory)
    {
        IWormhole.VM memory vaa = _verifyWormholeMessage(fastFillVaa);
        if (
            vaa.emitterChainId != _chainId
                || vaa.emitterAddress != address(this).toUniversalAddress()
        ) {
            revert ErrInvalidEmitterForFastFill();
        }

        FastFills storage fastFills = getFastFillsState();
        if (fastFills.redeemed[vaa.hash]) {
            revert ErrFastFillAlreadyRedeemed();
        }
        fastFills.redeemed[vaa.hash] = true;

        // Only the TokenRouter from this chain (_chainId) can redeem this message type.
        bytes32 expectedRouter = getRouterEndpointState().endpoints[_chainId].router;
        bytes32 callingRouter = msg.sender.toUniversalAddress();
        if (expectedRouter != callingRouter) {
            revert ErrInvalidSourceRouter(callingRouter, expectedRouter);
        }

        Messages.FastFill memory fastFill = vaa.payload.decodeFastFill();

        SafeERC20.safeTransfer(_token, msg.sender, fastFill.fillAmount);

        return fastFill;
    }

    // ------------------------------- Private ---------------------------------

    function _handleCctpTransfer(
        uint64 amount,
        uint16 sourceChain,
        Messages.FastMarketOrder memory order
    ) private returns (uint64 sequence) {
        if (order.targetChain == _chainId) {
            // Emit fast transfer fill for the token router on this chain.
            sequence = _wormhole.publishMessage{value: msg.value}(
                NONCE,
                Messages.FastFill({
                    fill: Messages.Fill({
                        sourceChain: sourceChain,
                        orderSender: order.sender,
                        redeemer: order.redeemer,
                        redeemerMessage: order.redeemerMessage
                    }),
                    fillAmount: amount
                }).encode(),
                FINALITY
            );
        } else {
            RouterEndpoint memory endpoint = getRouterEndpointState().endpoints[order.targetChain];

            // Burn the tokens and publish the message to the target chain.
            (sequence,) = burnAndPublish(
                endpoint.router,
                getCircleDomainsState().domains[order.targetChain],
                address(_token),
                amount,
                endpoint.mintRecipient,
                NONCE,
                Messages.Fill({
                    sourceChain: sourceChain,
                    orderSender: order.sender,
                    redeemer: order.redeemer,
                    redeemerMessage: order.redeemerMessage
                }).encode(),
                msg.value
            );
        }
    }

    function _improveBid(bytes32 auctionId, LiveAuctionData storage auction, uint64 feeBid)
        private
    {
        /**
         * SECURITY: This is a very important security check, and it
         * should not be removed. `placeInitialBid` will call this method
         * if an auction's status is `None`. This check will prevent a
         * user from creating an auction with a stale fast market order vaa.
         */
        if (auction.status != AuctionStatus.Active) {
            revert ErrAuctionNotActive(auctionId);
        }
        if (uint64(block.number) - auction.startBlock > getAuctionDuration()) {
            revert ErrAuctionPeriodExpired();
        }
        if (feeBid >= auction.bidPrice) {
            revert ErrBidPriceTooHigh(feeBid, auction.bidPrice);
        }

        // If the caller is not the current highest bidder, transfer the funds from the
        // new highest bidder to the old highest bidder.
        address currentHighestBidder = auction.highestBidder;
        if (currentHighestBidder != msg.sender) {
            SafeERC20.safeTransferFrom(
                _token, msg.sender, currentHighestBidder, auction.amount + auction.securityDeposit
            );
            auction.highestBidder = msg.sender;
            auction.bidPrice = feeBid;
        } else {
            // The current higested bidder is just improving their bid here.
            auction.bidPrice = feeBid;
        }

        emit NewBid(auctionId, feeBid, auction.bidPrice, msg.sender);
    }

    function _verifyRouterPath(uint16 chain, bytes32 fromRouter, uint16 targetChain) private view {
        bytes32 expectedRouter = getRouterEndpointState().endpoints[chain].router;
        if (fromRouter != expectedRouter) {
            revert ErrInvalidSourceRouter(fromRouter, expectedRouter);
        }

        if (getRouterEndpointState().endpoints[targetChain].router == bytes32(0)) {
            revert ErrInvalidTargetRouter(targetChain);
        }
    }

    function _verifyWormholeMessage(bytes calldata _vaa)
        private
        view
        returns (IWormhole.VM memory)
    {
        (IWormhole.VM memory vaa, bool valid, string memory reason) =
            _wormhole.parseAndVerifyVM(_vaa);

        if (!valid) {
            revert ErrInvalidWormholeMessage(reason);
        }

        return vaa;
    }
}
