// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
import {Messages} from "../../shared/Messages.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpointState, LiveAuctionData, getLiveAuctionInfo, InitialAuctionData, getInitialAuctionInfo, AuctionStatus} from "./Storage.sol";

abstract contract MatchingEngineFastOrders is State {
    using BytesParsing for bytes;
    using Messages for *;

    event AuctionStarted(
        bytes32 indexed auctionId,
        uint256 transferAmount,
        uint256 startingBid,
        address bidder
    );
    event NewBid(bytes32 indexed auctionId, uint256 newBid, uint256 oldBid, address bidder);

    // TODO: Do we need to protect against reentrancy, even though the `_token` is allow listed?
    // TODO: Should there be a minTickSize for new bids?
    // TODO: Should we give the user some chunk of the penalty?
    // TODO: Should we include the fee amount in the penalty calculation?
    // NOTE: Need to protect against starting a bid for an old fast VAA that was never completed.
    // TODO: How does the replay protection effect a fast transfer roll back and same
    // hash is created again?
    function placeInitialBid(bytes calldata fastTransferVaa, uint128 feeBid) external {
        IWormhole.VM memory vm = _verifyWormholeMessage(fastTransferVaa);

        Messages.FastMarketOrder memory order = fastTransferVaa.decodeFastMarketOrder();

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
        SafeERC20.safeTransferFrom(
            _token,
            msg.sender,
            address(this),
            order.amountIn + order.maxFee
        );

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
         */
        InitialAuctionData storage initialAuction = getInitialAuctionInfo().auctions[vm.hash];
        initialAuction.initialBidder = msg.sender;
        initialAuction.sourceChain = vm.emitterChainId;
        initialAuction.sourceRouter = vm.emitterAddress;
        initialAuction.slowSequence = order.slowSequence;

        emit AuctionStarted(vm.hash, order.amountIn, feeBid, msg.sender);
    }

    function improveBid(bytes32 auctionId, uint128 feeBid) public {
        // Fetch auction information, if it exists.
        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[auctionId];

        _improveBid(auctionId, auction, feeBid);
    }

    function executeFastOrder(
        bytes calldata fastTransferVaa
    ) external payable returns (uint64 sequence) {
        IWormhole.VM memory vm = _verifyWormholeMessage(fastTransferVaa);

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[vm.hash];

        if (auction.status != AuctionStatus.Active) {
            revert ErrAuctionNotActive(vm.hash);
        }

        uint256 blocksElapsed = uint88(block.number) - auction.startBlock;
        if (blocksElapsed <= AUCTION_DURATION) {
            revert ErrAuctionPeriodNotComplete();
        }

        Messages.FastMarketOrder memory order = fastTransferVaa.decodeFastMarketOrder();

        _verifyRouterPath(vm.emitterChainId, vm.emitterAddress, order.targetChain);

        if (blocksElapsed > AUCTION_GRACE_PERIOD) {
            uint256 penalty = _calculateDynamicPenalty(auction.securityDeposit, blocksElapsed);

            // Give the penalty amount to the liquidater and return the remaining
            // security deposit to the highest bidder.
            SafeERC20.safeTransfer(_token, msg.sender, penalty); // Should always be nonzero.
            SafeERC20.safeTransfer(
                _token,
                auction.highestBidder,
                auction.bidPrice + auction.securityDeposit - penalty
            );
        } else {
            if (auction.highestBidder != msg.sender) {
                revert ErrNotHighestBidder();
            }

            // Return the security deposit and the fee to the highest bidder.
            SafeERC20.safeTransfer(
                _token,
                auction.highestBidder,
                auction.bidPrice + auction.securityDeposit
            );
        }

        // Transfer funds to the recipient on the target chain.
        sequence = _handleCctpTransfer(
            auction.amount - auction.bidPrice - order.initAuctionFee,
            vm.emitterChainId,
            order
        );

        // Pay the auction initiator their fee.
        SafeERC20.safeTransfer(
            _token,
            getInitialAuctionInfo().auctions[vm.hash].initialBidder,
            order.initAuctionFee
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

        _verifyRouterPath(emitterChainId, emitterAddress, order.targetChain);

        LiveAuctionData storage auction = getLiveAuctionInfo().auctions[auctionId];

        if (auction.status == AuctionStatus.None) {
            sequence = _handleCctpTransfer(
                order.amountIn - order.maxFee,
                emitterChainId,
                order
            );

            // Pay the relayer the base fee if there was no auction.
            SafeERC20.safeTransfer(_token, msg.sender, order.maxFee);

            /*
             * SECURITY: this is a necessary secuity check. The will prevent a relayer from
             * starting an auction with the fast transfer VAA, even though the slow
             * relayer already delivered the slow VAA. Not setting this could lead
             * to trapped funds (which would require an upgrade to fix).
             */
            auction.status = AuctionStatus.Completed;
        } else if (auction.status == AuctionStatus.Active) {
            _assertVaaMatch(
                auctionId,
                emitterChainId,
                emitterAddress,
                params.encodedWormholeMessage.unsafeSequenceFromVaa()
            );

            // This means the slow message beat the fast message. We need to refund
            // the bidder and (potentially) take a penalty for not fulfilling their
            // obligation.
            uint256 penalty = _calculateDynamicPenalty(
                auction.securityDeposit,
                uint88(block.number) - auction.startBlock
            );

            // Transfer the penalty amount to the caller. Then transfer the
            // auction's highest bidder their funds back (security deposit - penalty).
            SafeERC20.safeTransfer(_token, msg.sender, penalty + order.maxFee);
            SafeERC20.safeTransfer(
                _token,
                auction.highestBidder,
                auction.amount + auction.securityDeposit - penalty
            );

            sequence = _handleCctpTransfer(
                auction.amount - order.maxFee,
                emitterChainId,
                order
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

    // ------------------------------- Private ---------------------------------

    function _handleCctpTransfer(
        uint256 amount,
        uint16 sourceChain,
        Messages.FastMarketOrder memory order
    ) private returns (uint64 sequence) {
       SafeERC20.safeIncreaseAllowance(_token, address(_wormholeCctp), amount);

        sequence = _wormholeCctp.transferTokensWithPayload{value: msg.value}(
        ICircleIntegration.TransferParameters({
            token: address(_token),
            amount: amount,
            targetChain: order.targetChain,
            mintRecipient: getRouterEndpointState().endpoints[order.targetChain]
        }),
        NONCE,
        Messages
            .Fill({
                sourceChain: sourceChain,
                orderSender: order.sender,
                redeemer: order.redeemer,
                redeemerMessage: order.redeemerMessage
            })
            .encode()
        );
    }

    function _improveBid(
        bytes32 auctionId,
        LiveAuctionData storage auction,
        uint128 feeBid
    ) private {
        /**
         * SECURITY: This is a very important security check, and it
         * should not be removed. `placeInitialBid` will call this method
         * if an auction's status is `None`. This check will prevent a
         * user from creating an auction with a stale fast market order vaa.
         */
        if (auction.status != AuctionStatus.Active) {
            revert ErrAuctionNotActive(auctionId);
        }
        if (uint88(block.number) - auction.startBlock > AUCTION_DURATION) {
            revert ErrAuctionPeriodExpired();
        }
        if (feeBid >= auction.bidPrice) {
            revert ErrBidPriceTooHigh(feeBid, auction.bidPrice);
        }

        // Transfer the funds from the new highest bidder to the old highest bidder.
        // This contract's balance shouldn't change.
        SafeERC20.safeTransferFrom(
            _token,
            msg.sender,
            auction.highestBidder,
            auction.amount + auction.securityDeposit
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
            initialAuction.sourceChain != emitterChainId ||
            initialAuction.sourceRouter != emitterAddress ||
            initialAuction.slowSequence != sequence
        ) {
            revert ErrVaaMismatch();
        }
    }

    function _calculateDynamicPenalty(
        uint256 amount,
        uint256 blocksElapsed
    ) private pure returns (uint256 penalty) {
        if (blocksElapsed <= AUCTION_GRACE_PERIOD) {
            return 0;
        }

        uint256 penaltyPeriod = blocksElapsed - AUCTION_GRACE_PERIOD;
        if (penaltyPeriod > PENALTY_BLOCKS) {
            return amount;
        }

        uint256 basePenalty = amount * INITIAL_PENALTY_BPS / MAX_BPS_FEE;

        return basePenalty + ((amount - basePenalty) * penaltyPeriod / PENALTY_BLOCKS);
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

    function _verifyWormholeMessage(bytes calldata vaa) private view returns (IWormhole.VM memory) {
        (IWormhole.VM memory vm, bool valid, string memory reason) =
            _wormhole.parseAndVerifyVM(vaa);

        if (!valid) {
            revert ErrInvalidWormholeMessage(reason);
        }

        return vm;
    }
}