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
import {FastTransferParameters} from "../../interfaces/ITokenRouterTypes.sol";
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

    /// @inheritdoc IPlaceMarketOrder
    function placeFastMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress,
        uint128 maxFee,
        uint32 deadline
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
            maxFee,
            deadline
        );
    }

    /// @inheritdoc IPlaceMarketOrder
    function placeFastMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        uint128 maxFee,
        uint32 deadline
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence) {
        (sequence, fastSequence) = _handleFastOrder(
            amountIn, 0, targetChain, redeemer, redeemerMessage, address(0), maxFee, deadline
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
        if (amountIn == 0) {
            revert ErrInsufficientAmount(0, 0);
        }

        bytes32 targetRouter = _verifyTarget(targetChain, redeemer);

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
        uint128 maxFee,
        uint32 deadline
    ) private returns (uint64 sequence, uint64 fastSequence) {
        // The Matching Engine chain is a fast finality chain already,
        // so we don't need to send a fast transfer message.
        if (_wormholeChainId == _matchingEngineChain) {
            revert ErrFastTransferNotSupported();
        }

        // Verify the `amountIn` and specified auction price.
        FastTransferParameters memory fastParams = getFastTransferParametersState();

        if (!fastParams.enabled) {
            revert ErrFastTransferDisabled();
        }
        if (amountIn > fastParams.maxAmount) {
            revert ErrAmountTooLarge(amountIn, fastParams.maxAmount);
        }
        if (amountIn <= maxFee) {
            revert ErrInsufficientAmount(amountIn, maxFee);
        }
        uint128 minimumRequiredFee = fastParams.baseFee + fastParams.initAuctionFee + 1;
        if (maxFee < minimumRequiredFee) {
            revert ErrInvalidMaxFee(maxFee, minimumRequiredFee);
        }

        _verifyTarget(targetChain, redeemer);

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
            Messages.SlowOrderResponse({baseFee: fastParams.baseFee}).encode()
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
                maxFee: maxFee - fastParams.initAuctionFee,
                initAuctionFee: fastParams.initAuctionFee,
                deadline: deadline,
                redeemerMessage: redeemerMessage
            }).encode(),
            FAST_FINALITY
        );
    }

    function _verifyTarget(uint16 targetChain, bytes32 redeemer)
        private
        view
        returns (bytes32 targetRouter)
    {
        if (redeemer == bytes32(0)) {
            revert ErrInvalidRedeemerAddress();
        }

        targetRouter = getRouter(targetChain);
        if (targetRouter == bytes32(0)) {
            revert ErrUnsupportedChain(targetChain);
        }
    }
}
