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
import {getFastTransferParametersState, FastTransferParameters} from "./Storage.sol";

import "../../interfaces/IPlaceMarketOrder.sol";

abstract contract PlaceMarketOrder is IPlaceMarketOrder, Admin, State {
    using BytesParsing for bytes;
    using Messages for *;

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(
        PlaceMarketOrderArgs calldata args
    ) external payable notPaused returns (uint64 sequence) {
        if (args.refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        sequence = _handleOrder(args);
    }

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(
        PlaceCctpMarketOrderArgs calldata args
    ) external payable notPaused returns (uint64 sequence) {
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

    function placeFastMarketOrder(
        PlaceMarketOrderArgs calldata args
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
        if (args.refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        (sequence, fastSequence) = _handleFastOrder(args);
    }

    function placeFastMarketOrder(
        PlaceCctpMarketOrderArgs calldata args
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
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

    function _handleOrder(
        PlaceMarketOrderArgs memory args
    ) private returns (uint64 sequence) {
        if (args.amountIn == 0) {
            revert ErrInsufficientAmount();
        }
        if (args.redeemer == bytes32(0)) {
            revert ErrInvalidRedeemerAddress();
        }

        bytes32 targetRouter = getRouter(args.targetChain);
        if (targetRouter == bytes32(0)) {
            revert ErrUnsupportedChain(args.targetChain);
        }

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
            Messages
                .Fill({
                    sourceChain: _wormholeChainId,
                    orderSender: toUniversalAddress(msg.sender),
                    redeemer: args.redeemer,
                    redeemerMessage: args.redeemerMessage
                })
                .encode()
        );
    }

    function _handleFastOrder(
        PlaceMarketOrderArgs memory args
    ) private returns (uint64 sequence, uint64 fastSequence) {
        if (args.redeemer == bytes32(0)) {
            revert ErrInvalidRedeemerAddress();
        }

        (uint256 fastTransferFee, uint256 baseFee) = _verifyFastOrderParams(args.amountIn);

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), args.amountIn);
        SafeERC20.safeIncreaseAllowance(_orderToken, address(_wormholeCctp), args.amountIn);

        // User needs to send enough value to pay for two Wormhole messages.
        uint256 messageFee = msg.value / 2;

        // Cache the `FastMarketOrder` struct.
        Messages.FastMarketOrder memory fastOrder = Messages.FastMarketOrder({
            minAmountOut: args.minAmountOut,
            targetChain: args.targetChain,
            redeemer: args.redeemer,
            sender: toUniversalAddress(msg.sender),
            refundAddress: toUniversalAddress(args.refundAddress),
            slowSequence: 0, // Only used by the fast transfer message.
            transferFee: baseFee,
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

        // Update the `transferFee` to the encoded minimum transfer fee for fast orders.
        fastOrder.transferFee = fastTransferFee;
        fastOrder.slowSequence = sequence;

        fastSequence = _wormhole.publishMessage{value: messageFee}(
            NONCE,
            fastOrder.encode(),
            FAST_FINALITY
        );
    }

    function _verifyFastOrderParams(
        uint256 amountIn
    ) private pure returns (uint256, uint256) {
        FastTransferParameters memory fastParams = getFastTransferParametersState();
        uint256 baseFee = uint256(fastParams.baseFee);
        uint256 feeInBps = uint256(fastParams.feeInBps);

        // The operator of this protocol can disable fast transfers by
        // setting `feeInBps` to zero.
        if (feeInBps == 0) {
            revert ErrFastTransferFeeUnset();
        }

        if (amountIn > fastParams.maxAmount) {
            revert ErrAmountTooLarge(amountIn, fastParams.maxAmount);
        }

        // This check is necessary to prevent an underflow in the unchecked block below.
        if (amountIn < baseFee) {
            revert ErrInsufficientAmount();
        }

        unchecked {
            // The fee should not be applied to the `baseFee` amount.
            uint256 fastTransferFee = (amountIn - baseFee) * feeInBps / MAX_BPS_FEE;

            if (fastTransferFee == 0) {
                revert ErrInsufficientFastTransferFee();
            }

            return (fastTransferFee, baseFee);
        }
    }
}