// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
import {Messages} from "../../shared/Messages.sol";
import {IMatchingEngineFastOrders} from "../../interfaces/IMatchingEngineFastOrders.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {toUniversalAddress} from "../../shared/Utils.sol";
import {
    getRouterEndpointState,
    LiveAuctionData,
    getLiveAuctionInfo,
    InitialAuctionData,
    getInitialAuctionInfo,
    AuctionStatus,
    getFastFillsState,
    FastFills,
    AuctionConfig,
    getAuctionConfig
} from "./Storage.sol";

// TODO: Do we need to protect against reentrancy, even though the `_token` is allow listed?
// TODO: Should there be a minTickSize for new bids?
// TODO: Should we include the fee amount in the penalty calculation?
// TODO: How does the replay protection effect a fast transfer roll back and same
// hash is created again?

abstract contract MatchingEngineFastOrders is IMatchingEngineFastOrders, State {
    using BytesParsing for bytes;
    using Messages for *;

    event AuctionStarted(
        bytes32 indexed auctionId, uint256 transferAmount, uint256 startingBid, address bidder
    );
    event NewBid(bytes32 indexed auctionId, uint256 newBid, uint256 oldBid, address bidder);

    function placeInitialBid(bytes calldata fastTransferVaa, uint128 feeBid) external {
        IWormhole.VM memory vm = _verifyWormholeMessage(fastTransferVaa);

        Messages.FastMarketOrder memory order = vm.payload.decodeFastMarketOrder();

        _verifyRouterPath(vm.emitterChainId, vm.emitterAddress, order.targetChain);

        // Confirm the auction hasn't started yet.
        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vm.hash];
        if (auction.status != AuctionStatus.None) {
            // Call `improveBid` so that relayers racing to start the auction
            // do not revert and waste gas.
            _improveBid(vm.hash, auction, feeBid);

            return;
        }
        if (feeBid > order.maxFee) {
            revert ErrBidPriceTooHigh(feeBid, order.maxFee);
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
        auction.startBlock = uint88(block.number);
        auction.highestBidder = msg.sender;
        auction.amount = order.amountIn;
        auction.securityDeposit = order.maxFee;
        auction.bidPrice = feeBid;

        /**
         * Set the initial auction data. The initial bidder will receive an
         * additional fee once the auction is completed for initializing the auction
         * and incurring the gas costs of verifying the VAA and setting initial state.
         *
         * We need to save the expected slow VAA emitter information so that we can
         * verify the slow VAA when it comes in.
         */
        InitialAuctionData storage initialAuction = getInitialAuctionInfo().auctions[vm.hash];
        initialAuction.initialBidder = msg.sender;
        initialAuction.slowChain = vm.emitterChainId;
        initialAuction.slowEmitter = _wormholeCctp.getRegisteredEmitter(vm.emitterChainId);
        initialAuction.slowSequence = order.slowSequence;

        emit AuctionStarted(vm.hash, order.amountIn, feeBid, msg.sender);
    }

    function improveBid(bytes32 auctionId, uint128 feeBid) public {
        // Fetch auction information, if it exists.
        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[auctionId];

        _improveBid(auctionId, auction, feeBid);
    }

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

        // Read the auction config from storage.
        AuctionConfig memory config = getAuctionConfig();

        uint256 blocksElapsed = uint88(block.number) - auction.startBlock;
        if (blocksElapsed <= config.auctionDuration) {
            revert ErrAuctionPeriodNotComplete();
        }

        Messages.FastMarketOrder memory order = vm.payload.decodeFastMarketOrder();

        _verifyRouterPath(vm.emitterChainId, vm.emitterAddress, order.targetChain);

        if (blocksElapsed > config.auctionGracePeriod) {
            (uint256 penalty, uint256 userReward) =
                _calculateDynamicPenalty(config, auction.securityDeposit, blocksElapsed);

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
                vm.emitterChainId,
                order
            );
        } else {
            if (msg.sender != auction.highestBidder) {
                revert ErrNotHighestBidder();
            }

            // Return the security deposit and the fee to the highest bidder.
            SafeERC20.safeTransfer(
                _token, auction.highestBidder, auction.bidPrice + auction.securityDeposit
            );

            // Transfer funds to the recipient on the target chain.
            sequence = _handleCctpTransfer(
                auction.amount - auction.bidPrice - order.initAuctionFee, vm.emitterChainId, order
            );
        }

        // Pay the auction initiator their fee.
        SafeERC20.safeTransfer(
            _token, getInitialAuctionInfo().auctions[vm.hash].initialBidder, order.initAuctionFee
        );

        auction.status = AuctionStatus.Completed;
    }

    function executeSlowOrderAndRedeem(
        bytes32 auctionId,
        ICircleIntegration.RedeemParameters calldata params
    ) external payable returns (uint64 sequence) {
        ICircleIntegration.DepositWithPayload memory deposit =
            _wormholeCctp.redeemTokensWithPayload(params);

        Messages.FastMarketOrder memory order = deposit.payload.decodeFastMarketOrder();

        // Parse the VAA and verify it's valid.
        uint16 emitterChainId = params.encodedWormholeMessage.unsafeEmitterChainFromVaa();
        bytes32 emitterAddress = params.encodedWormholeMessage.unsafeEmitterAddressFromVaa();

        _verifyRouterPath(emitterChainId, deposit.fromAddress, order.targetChain);

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[auctionId];

        if (auction.status == AuctionStatus.None) {
            sequence = _handleCctpTransfer(order.amountIn - order.maxFee, emitterChainId, order);

            // Pay the relayer the base fee if there was no auction.
            SafeERC20.safeTransfer(_token, msg.sender, order.maxFee);

            /*
             * SECURITY: this is a necessary security check. This will prevent a relayer from
             * starting an auction with the fast transfer VAA, even though the slow
             * relayer already delivered the slow VAA. Not setting this could lead
             * to trapped funds (which would require an upgrade to fix).
             */
            auction.status = AuctionStatus.Completed;
        } else if (auction.status == AuctionStatus.Active) {
            // TODO: handle the init auction fee.
            // TODO: this branch has not been tested yet, it's likely buggy.

            _assertVaaMatch(
                auctionId,
                emitterChainId,
                emitterAddress,
                params.encodedWormholeMessage.unsafeSequenceFromVaa()
            );

            /**
             * This means the slow message beat the fast message. We need to refund
             * the bidder and (potentially) take a penalty for not fulfilling their
             * obligation. The `penalty` CAN be zero in this case, since the auction
             * grace period might not have ended yet.
             */
            (uint256 penalty, uint256 userReward) = _calculateDynamicPenalty(
                getAuctionConfig(),
                auction.securityDeposit,
                uint88(block.number) - auction.startBlock
            );

            // The `order.maxFee` is the base relayer fee since were taking information
            // from the slow VAA.
            uint128 baseTransferFee = order.maxFee;

            // Transfer the penalty amount to the caller. The caller also earns the base
            // fee for relaying the slow VAA.
            SafeERC20.safeTransfer(_token, msg.sender, penalty + baseTransferFee);
            SafeERC20.safeTransfer(
                _token,
                auction.highestBidder,
                auction.amount + auction.securityDeposit - (penalty + userReward)
            );

            sequence = _handleCctpTransfer(
                auction.amount - baseTransferFee + userReward, emitterChainId, order
            );

            // Everyone's whole, set the auction as completed.
            auction.status = AuctionStatus.Completed;
        } else if (auction.status == AuctionStatus.Completed) {
            _assertVaaMatch(
                auctionId,
                emitterChainId,
                emitterAddress,
                params.encodedWormholeMessage.unsafeSequenceFromVaa()
            );

            if (msg.sender != auction.highestBidder) {
                revert ErrNotHighestBidder();
            }

            // Complete the transfer and give the highest bidder their funds back.
            SafeERC20.safeTransfer(_token, auction.highestBidder, auction.amount);
        } else {
            revert ErrInvalidAuctionStatus();
        }
    }

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

        // Only the TokenRouter from this chain (_wormholeChainId) can redeem this message type.
        bytes32 expectedRouter = getRouterEndpointState().endpoints[_wormholeChainId];
        bytes32 callingRouter = toUniversalAddress(msg.sender);
        if (expectedRouter != callingRouter) {
            revert ErrInvalidSourceRouter(callingRouter, expectedRouter);
        }

        FastFills storage fastFills = getFastFillsState();
        if (fastFills.redeemed[vm.hash]) {
            revert ErrFastFillAlreadyRedeemed();
        }
        fastFills.redeemed[vm.hash] = true;

        Messages.FastFill memory fastFill = vm.payload.decodeFastFill();

        SafeERC20.safeTransfer(_token, msg.sender, fastFill.fillAmount);

        return fastFill;
    }

    function calculateDynamicPenalty(uint256 amount, uint256 blocksElapsed)
        external
        pure
        returns (uint256 penalty, uint256 userReward)
    {
        return _calculateDynamicPenalty(getAuctionConfig(), amount, blocksElapsed);
    }

    // ------------------------------- Private ---------------------------------

    function _calculateDynamicPenalty(
        AuctionConfig memory config,
        uint256 amount,
        uint256 blocksElapsed
    ) private pure returns (uint256, uint256) {
        if (blocksElapsed <= config.auctionGracePeriod) {
            return (0, 0);
        }

        // If the `PENALTY_BLOCKS` state variable is set to zero,
        // the entire security deposit is taken as a penalty.
        uint256 penaltyPeriod = blocksElapsed - config.auctionGracePeriod;
        if (penaltyPeriod > config.penaltyBlocks) {
            uint256 userReward = amount * config.userPenaltyRewardBps / MAX_BPS_FEE;
            return (amount - userReward, userReward);
        }

        uint256 basePenalty = amount * config.initialPenaltyBps / MAX_BPS_FEE;
        uint256 penalty =
            basePenalty + ((amount - basePenalty) * penaltyPeriod / config.penaltyBlocks);
        uint256 userReward = penalty * config.userPenaltyRewardBps / MAX_BPS_FEE;

        return (penalty - userReward, userReward);
    }

    function _handleCctpTransfer(
        uint256 amount,
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
        if (uint88(block.number) - auction.startBlock > getAuctionDuration()) {
            revert ErrAuctionPeriodExpired();
        }
        if (feeBid >= auction.bidPrice) {
            revert ErrBidPriceTooHigh(feeBid, auction.bidPrice);
        }

        // Transfer the funds from the new highest bidder to the old highest bidder.
        // This contract's balance shouldn't change.
        SafeERC20.safeTransferFrom(
            _token, msg.sender, auction.highestBidder, auction.amount + auction.securityDeposit
        );

        // Update the auction data.
        auction.bidPrice = feeBid;
        auction.highestBidder = msg.sender;

        emit NewBid(auctionId, feeBid, auction.bidPrice, msg.sender);
    }

    function _assertVaaMatch(
        bytes32 auctionId,
        uint16 emitterChainId,
        bytes32 emitterAddress,
        uint64 sequence
    ) private view {
        InitialAuctionData memory initialAuction = getInitialAuctionInfo().auctions[auctionId];
        if (
            initialAuction.slowChain != emitterChainId
                || initialAuction.slowEmitter != emitterAddress
                || initialAuction.slowSequence != sequence
        ) {
            revert ErrVaaMismatch();
        }
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
}