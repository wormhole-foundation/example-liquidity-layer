// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.19;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
import {Utils} from "./Utils.sol";

library WormholeCctpMessages {
    using Utils for address;
    using BytesParsing for bytes;

    // Payload IDs.
    uint8 private constant DEPOSIT = 0x1;

    error MissingPayload();
    error PayloadTooLarge(uint256);
    error InvalidMessage();
    error UnexpectedMessageLength(uint256, uint256);

    function encodeDeposit(
        address token,
        uint256 amount,
        uint32 sourceCctpDomain,
        uint32 targetCctpDomain,
        uint64 cctpNonce,
        bytes32 burnSource,
        bytes32 mintRecipient,
        bytes memory payload
    ) internal pure returns (bytes memory encoded) {
        encoded = encodeDeposit(
            token.toUniversalAddress(),
            amount,
            sourceCctpDomain,
            targetCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
            payload
        );
    }

    function encodeDeposit(
        bytes32 universalTokenAddress,
        uint256 amount,
        uint32 sourceCctpDomain,
        uint32 targetCctpDomain,
        uint64 cctpNonce,
        bytes32 burnSource,
        bytes32 mintRecipient,
        bytes memory payload
    ) internal pure returns (bytes memory encoded) {
        uint256 payloadLen = payload.length;
        if (payloadLen == 0) {
            revert MissingPayload();
        } else if (payloadLen > type(uint16).max) {
            revert PayloadTooLarge(payloadLen);
        }

        encoded = abi.encodePacked(
            DEPOSIT,
            universalTokenAddress,
            amount,
            sourceCctpDomain,
            targetCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
            uint16(payloadLen),
            payload
        );
    }

    function decodeDeposit(IWormhole.VM memory vaa)
        internal
        pure
        returns (
            bytes32 token,
            uint256 amount,
            uint32 sourceCctpDomain,
            uint32 targetCctpDomain,
            uint64 cctpNonce,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        )
    {
        (
            token,
            amount,
            sourceCctpDomain,
            targetCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
            payload
        ) = decodeDeposit(vaa, true);
    }

    function decodeDeposit(IWormhole.VM memory vaa, bool revertCustomErrors)
        internal
        pure
        returns (
            bytes32 token,
            uint256 amount,
            uint32 sourceCctpDomain,
            uint32 targetCctpDomain,
            uint64 cctpNonce,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        )
    {
        bytes memory encoded = vaa.payload;
        uint256 offset = _checkPayloadId(encoded, 0, DEPOSIT, revertCustomErrors);

        (token, offset) = encoded.asBytes32Unchecked(offset);
        (amount, offset) = encoded.asUint256Unchecked(offset);
        (sourceCctpDomain, offset) = encoded.asUint32Unchecked(offset);
        (targetCctpDomain, offset) = encoded.asUint32Unchecked(offset);
        (cctpNonce, offset) = encoded.asUint64Unchecked(offset);
        (burnSource, offset) = encoded.asBytes32Unchecked(offset);
        (mintRecipient, offset) = encoded.asBytes32Unchecked(offset);
        (payload, offset) = _decodeBytes(encoded, offset);

        _checkLength(encoded.length, offset, revertCustomErrors);
    }

    // ---------------------------------------- private -------------------------------------------

    function _decodeBytes(bytes memory encoded, uint256 startOffset)
        private
        pure
        returns (bytes memory payload, uint256 offset)
    {
        uint16 payloadLength;
        (payloadLength, offset) = encoded.asUint16Unchecked(startOffset);
        (payload, offset) = encoded.sliceUnchecked(offset, payloadLength);
    }

    function _checkLength(uint256 actual, uint256 expected, bool revertCustomErrors) private pure {
        if (actual != expected) {
            if (revertCustomErrors) {
                revert UnexpectedMessageLength(actual, expected);
            } else {
                Utils.revertBuiltIn("invalid message length");
            }
        }
    }

    function _checkPayloadId(
        bytes memory encoded,
        uint256 startOffset,
        uint8 expectedPayloadId,
        bool revertCustomErrors
    ) private pure returns (uint256 offset) {
        uint8 parsedPayloadId;
        (parsedPayloadId, offset) = encoded.asUint8Unchecked(startOffset);

        if (parsedPayloadId != expectedPayloadId) {
            if (revertCustomErrors) {
                revert InvalidMessage();
            } else {
                Utils.revertBuiltIn("invalid message payloadId");
            }
        }
    }
}