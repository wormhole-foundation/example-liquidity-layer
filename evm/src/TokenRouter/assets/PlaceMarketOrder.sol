// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {fromUniversalAddress, toUniversalAddress} from "../../shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {FastTransferParameters} from "../../interfaces/Types.sol";
import {getFastTransferParametersState} from "./Storage.sol";

import "../../interfaces/IPlaceMarketOrder.sol";

abstract contract PlaceMarketOrder is IPlaceMarketOrder, Admin, State {
    using BytesParsing for bytes;
    using Messages for *;

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(PlaceMarketOrderArgs calldata args)
        external
        payable
        notPaused
        returns (uint64 sequence)
    {
        if (args.refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        sequence = _handleOrder(args);
    }

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(PlaceCctpMarketOrderArgs calldata args)
        external
        payable
        notPaused
        returns (uint64 sequence)
    {
        sequence = _handleOrder(
            PlaceMarketOrderArgs({
                amountIn: args.amountIn,
                minAmountOut: 0,
                targetChain: args.targetChain,
                redeemer: args.redeemer,
                redeemerMessage: args.redeemerMessage,
                refundAddress: address(0)
            })
        );
    }

    function placeFastMarketOrder(PlaceMarketOrderArgs calldata args)
        external
        payable
        notPaused
        returns (uint64 sequence, uint64 fastSequence)
    {
        if (args.refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        (sequence, fastSequence) = _handleFastOrder(args);
    }

    function placeFastMarketOrder(PlaceCctpMarketOrderArgs calldata args)
        external
        payable
        notPaused
        returns (uint64 sequence, uint64 fastSequence)
    {
        (sequence, fastSequence) = _handleFastOrder(
            PlaceMarketOrderArgs({
                amountIn: args.amountIn,
                minAmountOut: 0,
                targetChain: args.targetChain,
                redeemer: args.redeemer,
                redeemerMessage: args.redeemerMessage,
                refundAddress: address(0)
            })
        );
    }

    // ---------------------------------------- private -------------------------------------------

    function _handleOrder(PlaceMarketOrderArgs memory args) private returns (uint64 sequence) {
        bytes32 targetRouter = _verifyInputArguments(args);

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), args.amountIn);
        SafeERC20.safeIncreaseAllowance(_orderToken, address(_wormholeCctp), args.amountIn);

        sequence = _wormholeCctp.transferTokensWithPayload{value: msg.value}(
            ICircleIntegration.TransferParameters({
                token: address(_orderToken),
                amount: args.amountIn,
                targetChain: args.targetChain,
                mintRecipient: targetRouter
            }),
            NONCE,
            Messages.Fill({
                sourceChain: _wormholeChainId,
                orderSender: toUniversalAddress(msg.sender),
                redeemer: args.redeemer,
                redeemerMessage: args.redeemerMessage
            }).encode()
        );
    }

    function _handleFastOrder(PlaceMarketOrderArgs memory args)
        private
        returns (uint64 sequence, uint64 fastSequence)
    {
        // The Matching Engine chain is a fast finality chain already,
        // so we don't need to send a fast transfer message.
        if (_wormholeChainId == _matchingEngineChain) {
            revert ErrFastTransferNotSupported();
        }

        _verifyInputArguments(args);

        (uint128 dynamicFastTransferFee, uint128 baseFee, uint128 initAuctionFee) =
            _verifyFastOrderParams(args.amountIn);

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), args.amountIn);
        SafeERC20.safeIncreaseAllowance(_orderToken, address(_wormholeCctp), args.amountIn);

        // User needs to send enough value to pay for two Wormhole messages.
        uint256 messageFee = msg.value / 2;

        // Cache the `FastMarketOrder` struct.
        Messages.FastMarketOrder memory fastOrder = Messages.FastMarketOrder({
            amountIn: args.amountIn,
            minAmountOut: args.minAmountOut,
            targetChain: args.targetChain,
            redeemer: args.redeemer,
            sender: toUniversalAddress(msg.sender),
            refundAddress: toUniversalAddress(args.refundAddress),
            slowSequence: 0, // Only used by the fast transfer message.
            slowEmitter: bytes32(0), // Only used by the fast transfer message.
            maxFee: baseFee,
            initAuctionFee: 0, // Only used by the fast transfer message.
            redeemerMessage: args.redeemerMessage
        });

        // Send the slow CCTP transfer with the `baseFee` as the `transferFee`.
        sequence = _wormholeCctp.transferTokensWithPayload{value: messageFee}(
            ICircleIntegration.TransferParameters({
                token: address(_orderToken),
                amount: args.amountIn,
                targetChain: _matchingEngineChain,
                mintRecipient: _matchingEngineAddress
            }),
            NONCE,
            fastOrder.encode()
        );

        // Update the fees and sequence for the fast transfer message.
        fastOrder.maxFee = dynamicFastTransferFee + baseFee;
        fastOrder.initAuctionFee = initAuctionFee;
        fastOrder.slowSequence = sequence;
        fastOrder.slowEmitter = toUniversalAddress(address(_wormholeCctp));

        fastSequence =
            _wormhole.publishMessage{value: messageFee}(NONCE, fastOrder.encode(), FAST_FINALITY);
    }

    function _verifyFastOrderParams(uint256 amountIn)
        private
        pure
        returns (uint128, uint128, uint128)
    {
        FastTransferParameters memory fastParams = getFastTransferParametersState();
        uint128 feeInBps = uint128(fastParams.feeInBps);

        // The operator of this protocol can disable fast transfers by
        // setting `feeInBps` to zero.
        if (feeInBps == 0) {
            revert ErrFastTransferFeeUnset();
        }

        if (amountIn > fastParams.maxAmount) {
            revert ErrAmountTooLarge(amountIn, fastParams.maxAmount);
        }

        // This check is necessary to prevent an underflow in the unchecked block below.
        uint128 staticFee = fastParams.baseFee + fastParams.initAuctionFee;
        if (amountIn <= staticFee) {
            revert ErrInsufficientAmount();
        }

        unchecked {
            /**
             * The fee should not be applied to the `baseFee` or `initAuctionFee`. Also, we can
             * safely cast the result to `uint128` because we know that `amountIn` is less than
             * or equal to `fastParams.maxAmount` which is a uint128.
             */
            uint128 dynamicFastTransferFee =
                uint128((amountIn - staticFee) * feeInBps / MAX_BPS_FEE);

            return (dynamicFastTransferFee, fastParams.baseFee, fastParams.initAuctionFee);
        }
    }

    function _verifyInputArguments(PlaceMarketOrderArgs memory args)
        private
        view
        returns (bytes32 targetRouter)
    {
        if (args.amountIn == 0) {
            revert ErrInsufficientAmount();
        }
        if (args.redeemer == bytes32(0)) {
            revert ErrInvalidRedeemerAddress();
        }

        targetRouter = getRouter(args.targetChain);
        if (targetRouter == bytes32(0)) {
            revert ErrUnsupportedChain(args.targetChain);
        }
    }
}
