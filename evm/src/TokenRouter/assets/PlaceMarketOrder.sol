// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

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
        bytes32 targetRouter = _verifyOrder(args.amountIn, args.redeemer, args.targetChain);

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
        //bytes32 targetRouter = _verifyOrder(args.amountIn, args.redeemer, args.targetChain);

        return (sequence, fastSequence);
    }

    function _verifyOrder(
        uint256 amountIn,
        bytes32 redeemer,
        uint16 targetChain
    ) private view returns (bytes32 targetRouter) {
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
