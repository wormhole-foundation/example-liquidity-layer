// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {Utils} from "../../shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {FastTransferParameters} from "../../interfaces/ITokenRouterTypes.sol";
import {getFastTransferParametersState, getCircleDomainsState} from "./Storage.sol";

import "../../interfaces/IPlaceMarketOrder.sol";

abstract contract PlaceMarketOrder is IPlaceMarketOrder, Admin, State {
    using BytesParsing for bytes;
    using Utils for address;
    using Messages for *;

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(
        uint128 amountIn,
        uint128 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) external payable notPaused returns (uint64 sequence, uint64 cctpNonce) {
        if (refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        return _handleOrder(
            amountIn, minAmountOut, targetChain, redeemer, redeemerMessage, refundAddress
        );
    }

    /// @inheritdoc IPlaceMarketOrder
    function placeMarketOrder(
        uint128 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage
    ) external payable notPaused returns (uint64 sequence, uint64 cctpNonce) {
        return _handleOrder(amountIn, 0, targetChain, redeemer, redeemerMessage, address(0));
    }

    /// @inheritdoc IPlaceMarketOrder
    function placeFastMarketOrder(
        uint128 amountIn,
        uint128 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress,
        uint128 maxFee,
        uint32 deadline
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence, uint64 cctpNonce) {
        if (refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }
        return _handleFastOrder(
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
        uint128 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        uint128 maxFee,
        uint32 deadline
    ) external payable notPaused returns (uint64 sequence, uint64 fastSequence, uint64 cctpNonce) {
        return _handleFastOrder(
            amountIn, 0, targetChain, redeemer, redeemerMessage, address(0), maxFee, deadline
        );
    }

    // ---------------------------------------- private -------------------------------------------

    function _handleOrder(
        uint128 amountIn,
        uint128 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) private returns (uint64 sequence, uint64 cctpNonce) {
        if (amountIn == 0) {
            revert ErrInsufficientAmount(0, 0);
        }

        bytes32 targetRouter = _verifyTarget(targetChain, redeemer);

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), amountIn);

        (sequence, cctpNonce) = burnAndPublish(
            targetRouter,
            getCircleDomainsState().domains[targetChain],
            address(_orderToken),
            amountIn,
            targetRouter,
            NONCE,
            Messages.Fill({
                sourceChain: _chainId,
                orderSender: msg.sender.toUniversalAddress(),
                redeemer: redeemer,
                redeemerMessage: redeemerMessage
            }).encode(),
            msg.value
        );
    }

    function _handleFastOrder(
        uint128 amountIn,
        uint128 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress,
        uint128 maxFee,
        uint32 deadline
    ) private returns (uint64 sequence, uint64 fastSequence, uint64 cctpNonce) {
        // The Matching Engine chain is a fast finality chain already,
        // so we don't need to send a fast transfer message.
        if (_chainId == _matchingEngineChain) {
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

        // User needs to send enough value to pay for two Wormhole messages.
        uint256 messageFee = msg.value / 2;

        (sequence, cctpNonce) = burnAndPublish(
            _matchingEngineAddress,
            _matchingEngineDomain,
            address(_orderToken),
            amountIn,
            _matchingEngineAddress,
            NONCE,
            Messages.SlowOrderResponse({baseFee: fastParams.baseFee}).encode(),
            messageFee
        );

        // Send the faster-than-finality message.
        fastSequence = _wormhole.publishMessage{value: messageFee}(
            NONCE,
            Messages.FastMarketOrder({
                amountIn: amountIn,
                minAmountOut: minAmountOut,
                targetChain: targetChain,
                targetDomain: getCircleDomainsState().domains[targetChain],
                redeemer: redeemer,
                sender: msg.sender.toUniversalAddress(),
                refundAddress: refundAddress.toUniversalAddress(),
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

        // This check also validates that a target domain has been set.
        targetRouter = getRouter(targetChain);
        if (targetRouter == bytes32(0)) {
            revert ErrUnsupportedChain(targetChain);
        }
    }
}
