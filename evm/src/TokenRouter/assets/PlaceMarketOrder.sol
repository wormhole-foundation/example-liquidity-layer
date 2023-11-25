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
    function placeMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) external payable notPaused returns (uint64 sequence) {
        if (refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        sequence = _handleOrder(
            amountIn, minAmountOut, targetChain, redeemer, redeemerMessage, refundAddress
        );
    }

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage
    ) external payable notPaused returns (uint64 sequence) {
        sequence = _handleOrder(amountIn, 0, targetChain, redeemer, redeemerMessage, address(0));
    }

    function placeFastMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
        if (refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        (sequence, fastSequence) = _handleFastOrder(
            amountIn, minAmountOut, targetChain, redeemer, redeemerMessage, refundAddress, 0
        );
    }

    function placeFastMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
        (sequence, fastSequence) = _handleFastOrder(
            amountIn,
            0,
            targetChain,
            redeemer,
            redeemerMessage,
            address(0),
            0 // maxFeeOverride
        );
    }

    function placeFastMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress,
        uint128 maxFeeOverride
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
        if (refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        (sequence, fastSequence) = _handleFastOrder(
            amountIn,
            minAmountOut,
            targetChain,
            redeemer,
            redeemerMessage,
            refundAddress,
            maxFeeOverride
        );
    }

    function placeFastMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        uint128 maxFeeOverride
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
        (sequence, fastSequence) = _handleFastOrder(
            amountIn, 0, targetChain, redeemer, redeemerMessage, address(0), maxFeeOverride
        );
    }

    // ---------------------------------------- private -------------------------------------------

    function _handleOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) private returns (uint64 sequence) {
        bytes32 targetRouter = _verifyInputArguments(amountIn, targetChain, redeemer);

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), amountIn);
        SafeERC20.safeIncreaseAllowance(_orderToken, address(_wormholeCctp), amountIn);

        sequence = _wormholeCctp.transferTokensWithPayload{value: msg.value}(
            ICircleIntegration.TransferParameters({
                token: address(_orderToken),
                amount: amountIn,
                targetChain: targetChain,
                mintRecipient: targetRouter
            }),
            NONCE,
            Messages.Fill({
                sourceChain: _wormholeChainId,
                orderSender: toUniversalAddress(msg.sender),
                redeemer: redeemer,
                redeemerMessage: redeemerMessage
            }).encode()
        );
    }

    function _handleFastOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress,
        uint128 maxFeeOverride
    ) private returns (uint64 sequence, uint64 fastSequence) {
        // The Matching Engine chain is a fast finality chain already,
        // so we don't need to send a fast transfer message.
        if (_wormholeChainId == _matchingEngineChain) {
            revert ErrFastTransferNotSupported();
        }

        _verifyInputArguments(amountIn, targetChain, redeemer);

        // Verify fast transfer input parameters and also calculate the fast transfer fees.
        (uint128 dynamicFastTransferFee, uint128 baseFee, uint128 initAuctionFee) =
            _verifyFastOrderParams(amountIn);

        // Override the maxTransferFee if the `maxFeeOverride` is large enough. The `baseFee`
        // should be baked into the `maxFeeOverride` value.
        uint128 maxTransferFee = dynamicFastTransferFee + baseFee;
        if (maxFeeOverride != 0) {
            if ((maxTransferFee > maxFeeOverride) || maxFeeOverride >= amountIn) {
                revert ErrInsufficientFeeOverride();
            } else {
                maxTransferFee = maxFeeOverride;
            }
        }

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), amountIn);
        SafeERC20.safeIncreaseAllowance(_orderToken, address(_wormholeCctp), amountIn);

        // User needs to send enough value to pay for two Wormhole messages.
        uint256 messageFee = msg.value / 2;

        // Send the slow CCTP transfer with the `baseFee` as the `transferFee`.
        sequence = _wormholeCctp.transferTokensWithPayload{value: messageFee}(
            ICircleIntegration.TransferParameters({
                token: address(_orderToken),
                amount: amountIn,
                targetChain: _matchingEngineChain,
                mintRecipient: _matchingEngineAddress
            }),
            NONCE,
            Messages.SlowOrderResponse({baseFee: baseFee}).encode()
        );

        // Send the faster-than-finality message.
        fastSequence = _wormhole.publishMessage{value: messageFee}(
            NONCE,
            Messages.FastMarketOrder({
                amountIn: amountIn,
                minAmountOut: minAmountOut,
                targetChain: targetChain,
                redeemer: redeemer,
                sender: toUniversalAddress(msg.sender),
                refundAddress: toUniversalAddress(refundAddress),
                slowSequence: sequence,
                slowEmitter: toUniversalAddress(address(_wormholeCctp)),
                maxFee: maxTransferFee,
                initAuctionFee: initAuctionFee,
                redeemerMessage: redeemerMessage
            }).encode(),
            FAST_FINALITY
        );
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

    function _verifyInputArguments(uint256 amountIn, uint16 targetChain, bytes32 redeemer)
        private
        view
        returns (bytes32 targetRouter)
    {
        if (amountIn == 0) {
            revert ErrInsufficientAmount();
        }
        if (redeemer == bytes32(0)) {
            revert ErrInvalidRedeemerAddress();
        }

        targetRouter = getRouter(targetChain);
        if (targetRouter == bytes32(0)) {
            revert ErrUnsupportedChain(targetChain);
        }
    }
}
