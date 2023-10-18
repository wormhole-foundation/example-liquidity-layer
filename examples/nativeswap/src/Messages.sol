// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {BytesLib} from "wormhole-solidity/BytesLib.sol";

/// @title Helper contract for cross-chain swaps
/// @notice Contains functions necessary for parsing encoded swap parameters
contract Messages {
    using BytesLib for bytes;

    struct ExactInParameters {
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint256 targetAmountOutMinimum;
        bytes32 targetChainRecipient;
        uint256 deadline;
        uint24 poolFee;
    }

    struct RecvSwapInParameters {
        uint256 estimatedAmount;
        bytes32 recipientAddress;
        address[2] path;
        uint256 deadline;
        uint24 poolFee;
        uint256 relayerFee;
    }

    function decodeSwapInParameters(
        bytes memory encoded
    ) public pure returns (RecvSwapInParameters memory params) {
        uint256 index = 0;

        // payloadId
        uint8 payloadId = encoded.toUint8(index);
        index += 1;
        require(payloadId == 1, "invalid payload");

        // amount out minimum
        params.estimatedAmount = encoded.toUint256(index);
        index += 32;

        // recipient of swapped amount
        params.recipientAddress = encoded.toBytes32(index);
        index += 32;

        // execution path
        params.path[0] = encoded.toAddress(index);
        index += 20;

        params.path[1] = encoded.toAddress(index);
        index += 20;

        // trade deadline
        params.deadline = encoded.toUint256(index);
        index += 32;

        // skip a byte
        index += 1;

        // pool fee
        params.poolFee = encoded.toUint16(index);
        index += 2;

        // relayer fee
        params.relayerFee = encoded.toUint256(index);
        index += 32;

        require(index == encoded.length, "invalid swap payload");
    }
}