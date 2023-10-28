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

import "../../interfaces/IPlaceMarketOrder.sol";

abstract contract PlaceMarketOrder is IPlaceMarketOrder, Admin, State {
    using BytesParsing for bytes;
    using Messages for *;

    function placeMarketOrder(
        PlaceMarketOrderArgs calldata args
    ) external payable notPaused returns (uint64 sequence) {
        sequence = _placeMarketOrder(args);
    }

    function _placeMarketOrder(
        PlaceMarketOrderArgs calldata args
    ) private returns (uint64 sequence) {
        if (args.amountIn == 0) {
            revert ErrInsufficientAmount();
        }
        if (args.redeemer == bytes32(0)) {
            revert ErrInvalidRedeemerAddress();
        }
        if (args.refundAddress == address(0)) {
            revert ErrInvalidRefundAddress();
        }

        bytes32 dstEndpoint = getRouter(args.targetChain);
        if (dstEndpoint == bytes32(0)) {
            revert ErrUnsupportedChain(args.targetChain);
        }

        SafeERC20.safeTransferFrom(_orderToken, msg.sender, address(this), args.amountIn);

        // Handle regular CCTP -> CCTP transfers.
        sequence = _handleTransfer(args, dstEndpoint);
    }

    function _handleTransfer(
        PlaceMarketOrderArgs calldata args,
        bytes32 dstEndpoint
    ) private returns (uint64 sequence) {
        SafeERC20.safeIncreaseAllowance(_orderToken, address(_wormholeCctp), args.amountIn);

        sequence = _wormholeCctp.transferTokensWithPayload{value: msg.value}(
            ICircleIntegration.TransferParameters({
                token: address(_orderToken),
                amount: args.amountIn,
                targetChain: args.targetChain,
                mintRecipient: dstEndpoint
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
}
