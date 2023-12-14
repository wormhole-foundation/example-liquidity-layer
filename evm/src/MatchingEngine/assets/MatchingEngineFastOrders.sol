// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
import {Messages} from "../../shared/Messages.sol";
import {IMatchingEngineFastOrders} from "../../interfaces/IMatchingEngineFastOrders.sol";
import {IMarketMaker} from "../../interfaces/IMarketMaker.sol";
import "../../interfaces/IMarketMakerTypes.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {toUniversalAddress} from "../../shared/Utils.sol";
import {
    getRouterEndpointState,
    LiveAuctionData,
    getLiveAuctionInfo,
    AuctionStatus,
    getFastFillsState,
    FastFills
} from "./Storage.sol";

abstract contract MatchingEngineFastOrders is IMatchingEngineFastOrders, State {
    using BytesParsing for bytes;
    using Messages for *;

    event AuctionStarted(
        bytes32 indexed auctionId, uint128 transferAmount, uint128 startingBid, address bidder
    );
    event NewBid(bytes32 indexed auctionId, uint128 newBid, uint128 oldBid, address bidder);

    /// @inheritdoc IMatchingEngineFastOrders
    function placeInitialBid(bytes calldata fastTransferVaa, uint128 feeBid) external {
        IWormhole.VM memory vm = _verifyWormholeMessage(fastTransferVaa);

        Messages.FastMarketOrder memory order = vm.payload.decodeFastMarketOrder();

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
        _verifyRouterPath(vm.emitterChainId, vm.emitterAddress, order.targetChain);

        // Confirm the auction hasn't started yet.
        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vm.hash];
        if (auction.status != AuctionStatus.None) {
            // Call `improveBid` so that relayers racing to start the auction
            // do not revert and waste gas.
            _improveBid(vm.hash, auction, feeBid);

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
        auction.startBlock = uint128(block.number);
        auction.highestBidder = msg.sender;
        auction.initialBidder = msg.sender;
        auction.amount = order.amountIn;
        auction.securityDeposit = order.maxFee;
        auction.bidPrice = feeBid;

        emit AuctionStarted(vm.hash, order.amountIn, feeBid, msg.sender);
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function improveBid(bytes32 auctionId, uint128 feeBid) public {
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
        IWormhole.VM memory vm = _verifyWormholeMessage(fastTransferVaa);

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vm.hash];

        if (auction.status != AuctionStatus.Active) {
            revert ErrAuctionNotActive(vm.hash);
        }

        uint128 blocksElapsed = uint128(block.number) - auction.startBlock;
        if (blocksElapsed <= _auctionDuration) {
            revert ErrAuctionPeriodNotComplete();
        }

        Messages.FastMarketOrder memory order = vm.payload.decodeFastMarketOrder();

        uint128 totalPenalty = 0;
        address highestBidder = auction.highestBidder;

        if (blocksElapsed > _auctionGracePeriod) {
            (uint128 penalty, uint128 userReward) =
                calculateDynamicPenalty(auction.securityDeposit, blocksElapsed);

            // Set the total penalty amount, this value is only used when
            // a MarketMaker contract is the higest bidder.
            totalPenalty = penalty + userReward;

            /**
             * Give the penalty amount to the liquidator and return the remaining
             * security deposit to the highest bidder. The penalty should always be
             * nonzero in this branch. Also, pay the user a `reward` for having to
             * wait longer than the auction grace period.
             */
            SafeERC20.safeTransfer(_token, msg.sender, penalty);
            SafeERC20.safeTransfer(
                _token, highestBidder, auction.bidPrice + auction.securityDeposit - totalPenalty
            );

            // Transfer funds to the recipient on the target chain.
            sequence = _handleCctpTransfer(
                auction.amount - auction.bidPrice - order.initAuctionFee + userReward,
                vm.emitterChainId,
                order
            );
        } else {
            // Return the security deposit and the fee to the highest bidder.
            SafeERC20.safeTransfer(
                _token, highestBidder, auction.bidPrice + auction.securityDeposit
            );

            // Transfer funds to the recipient on the target chain.
            sequence = _handleCctpTransfer(
                auction.amount - auction.bidPrice - order.initAuctionFee, vm.emitterChainId, order
            );
        }

        // Pay the auction initiator their fee.
        address initialBidder = auction.initialBidder;
        SafeERC20.safeTransfer(_token, initialBidder, order.initAuctionFee);

        // Set the auction as completed.
        auction.status = AuctionStatus.Completed;

        _completeAuctionOnMarketMaker(
            vm.hash,
            uint64(totalPenalty),
            uint64(order.initAuctionFee),
            initialBidder,
            highestBidder
        );
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function executeSlowOrderAndRedeem(
        bytes calldata fastTransferVaa,
        ICircleIntegration.RedeemParameters calldata params
    ) external payable returns (uint64 sequence) {
        IWormhole.VM memory vm = _verifyWormholeMessage(fastTransferVaa);

        // Redeem the slow CCTP transfer.
        ICircleIntegration.DepositWithPayload memory deposit =
            _wormholeCctp.redeemTokensWithPayload(params);

        Messages.FastMarketOrder memory order = vm.payload.decodeFastMarketOrder();

        // Parse the VAA key from the slow CCTP message payload.
        (uint16 cctpEmitterChain, bytes32 cctpEmitterAddress, uint64 cctpSequence) =
            params.encodedWormholeMessage.unsafeVaaKeyFromVaa();

        // Confirm that the fast transfer VAA is associated with the slow transfer VAA.
        if (
            vm.emitterChainId != cctpEmitterChain || order.slowEmitter != cctpEmitterAddress
                || order.slowSequence != cctpSequence
        ) {
            revert ErrVaaMismatch();
        }

        // Parse the `maxFee` from the slow VAA.
        uint128 baseFee = deposit.payload.decodeSlowOrderResponse().baseFee;

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vm.hash];

        if (auction.status == AuctionStatus.None) {
            // SECURITY: We need to verify the router path, since an auction was never created
            // and this check is done in `placeInitialBid`.
            _verifyRouterPath(cctpEmitterChain, deposit.fromAddress, order.targetChain);

            sequence = _handleCctpTransfer(order.amountIn - baseFee, cctpEmitterChain, order);

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
            (uint128 penalty, uint128 userReward) = calculateDynamicPenalty(
                auction.securityDeposit, uint128(block.number) - auction.startBlock
            );

            // Cache for gas savings.
            uint128 totalPenalty = penalty + userReward;
            address highestBidder = auction.highestBidder;

            // Transfer the penalty amount to the caller. The caller also earns the base
            // fee for relaying the slow VAA.
            SafeERC20.safeTransfer(_token, msg.sender, penalty + baseFee);
            SafeERC20.safeTransfer(
                _token, highestBidder, auction.amount + auction.securityDeposit - totalPenalty
            );

            sequence =
                _handleCctpTransfer(auction.amount - baseFee + userReward, cctpEmitterChain, order);

            // Everyone's whole, set the auction as completed.
            auction.status = AuctionStatus.Completed;

            _refundMarketMaker(
                vm.hash, uint64(totalPenalty), highestBidder, Callback.AuctionComplete
            );
        } else if (auction.status == AuctionStatus.Completed) {
            address highestBidder = auction.highestBidder;

            // Transfer the funds back to the highest bidder.
            SafeERC20.safeTransfer(_token, highestBidder, auction.amount);

            _refundMarketMaker(vm.hash, 0, highestBidder, Callback.Outbid);
        } else {
            revert ErrInvalidAuctionStatus();
        }
    }

    /// @inheritdoc IMatchingEngineFastOrders
    function redeemFastFill(bytes calldata fastFillVaa)
        external
        returns (Messages.FastFill memory)
    {
        IWormhole.VM memory vm = _verifyWormholeMessage(fastFillVaa);
        if (
            vm.emitterChainId != _wormholeChainId
                || vm.emitterAddress != toUniversalAddress(address(this))
        ) {
            revert ErrInvalidEmitterForFastFill();
        }

        FastFills storage fastFills = getFastFillsState();
        if (fastFills.redeemed[vm.hash]) {
            revert ErrFastFillAlreadyRedeemed();
        }
        fastFills.redeemed[vm.hash] = true;

        // Only the TokenRouter from this chain (_wormholeChainId) can redeem this message type.
        bytes32 expectedRouter = getRouterEndpointState().endpoints[_wormholeChainId];
        bytes32 callingRouter = toUniversalAddress(msg.sender);
        if (expectedRouter != callingRouter) {
            revert ErrInvalidSourceRouter(callingRouter, expectedRouter);
        }

        Messages.FastFill memory fastFill = vm.payload.decodeFastFill();

        SafeERC20.safeTransfer(_token, msg.sender, fastFill.fillAmount);

        return fastFill;
    }

    // ------------------------------- Private ---------------------------------

    function _handleCctpTransfer(
        uint128 amount,
        uint16 sourceChain,
        Messages.FastMarketOrder memory order
    ) private returns (uint64 sequence) {
        if (order.targetChain == _wormholeChainId) {
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
            SafeERC20.safeIncreaseAllowance(_token, address(_wormholeCctp), amount);

            sequence = _wormholeCctp.transferTokensWithPayload{value: msg.value}(
                ICircleIntegration.TransferParameters({
                    token: address(_token),
                    amount: amount,
                    targetChain: order.targetChain,
                    mintRecipient: getRouterEndpointState().endpoints[order.targetChain]
                }),
                NONCE,
                Messages.Fill({
                    sourceChain: sourceChain,
                    orderSender: order.sender,
                    redeemer: order.redeemer,
                    redeemerMessage: order.redeemerMessage
                }).encode()
            );
        }
    }

    function _improveBid(bytes32 auctionId, LiveAuctionData storage auction, uint128 feeBid)
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
        if (uint128(block.number) - auction.startBlock > getAuctionDuration()) {
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

            _refundMarketMaker(auctionId, 0, currentHighestBidder, Callback.Outbid);
        } else {
            // The current higested bidder is just improving their bid here.
            auction.bidPrice = feeBid;
        }

        emit NewBid(auctionId, feeBid, auction.bidPrice, msg.sender);
    }

    function _verifyRouterPath(uint16 chain, bytes32 fromRouter, uint16 targetChain) private view {
        bytes32 expectedRouter = getRouterEndpointState().endpoints[chain];
        if (fromRouter != expectedRouter) {
            revert ErrInvalidSourceRouter(fromRouter, expectedRouter);
        }

        if (getRouterEndpointState().endpoints[targetChain] == bytes32(0)) {
            revert ErrInvalidTargetRouter(targetChain);
        }
    }

    function _verifyWormholeMessage(bytes calldata vaa)
        private
        view
        returns (IWormhole.VM memory)
    {
        (IWormhole.VM memory vm, bool valid, string memory reason) = _wormhole.parseAndVerifyVM(vaa);

        if (!valid) {
            revert ErrInvalidWormholeMessage(reason);
        }

        return vm;
    }

    function _completeAuctionOnMarketMaker(
        bytes32 auctionId,
        uint64 penalty,
        uint64 initAuctionFee,
        address initialBidder,
        address highestBidder
    ) private {
        if (initialBidder == highestBidder) {
            if (isMarketMaker(initialBidder)) {
                IMarketMaker(initialBidder).updateAuctionStatus(
                    auctionId, penalty, initAuctionFee, Callback.WonAuction
                );
            }
        } else {
            if (isMarketMaker(highestBidder)) {
                IMarketMaker(highestBidder).updateAuctionStatus(
                    auctionId, penalty, 0, Callback.WonAuction
                );
            } else if (isMarketMaker(initialBidder)) {
                IMarketMaker(initialBidder).updateAuctionStatus(
                    auctionId, 0, initAuctionFee, Callback.FeeOnly
                );
            } else {
                return;
            }
        }
    }

    function _refundMarketMaker(
        bytes32 auctionId,
        uint64 penalty,
        address highestBidder,
        Callback callbackType
    ) private {
        if (!isMarketMaker(highestBidder)) {
            return;
        } else {
            if (callbackType == Callback.Outbid) {
                IMarketMaker(highestBidder).updateAuctionStatus(auctionId, 0, 0, Callback.Outbid);
            } else if (callbackType == Callback.AuctionComplete) {
                IMarketMaker(highestBidder).updateAuctionStatus(
                    auctionId, penalty, 0, Callback.AuctionComplete
                );
            } else {
                revert ErrInvalidCallbackType();
            }
        }
    }
}
