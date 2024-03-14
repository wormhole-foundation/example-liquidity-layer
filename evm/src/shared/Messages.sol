// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity-sdk/libraries/BytesParsing.sol";

library Messages {
    using BytesParsing for bytes;

    // Payload IDs. Payloads IDs 1-10 are reserved for messages that are
    // paired with a CCTP transfeer.
    uint8 private constant FILL = 1;
    uint8 private constant SLOW_ORDER_RESPONSE = 2;
    uint8 private constant FAST_MARKET_ORDER = 11;
    uint8 private constant FAST_FILL = 12;

    // VAA fields.
    uint256 private constant SIG_COUNT_OFFSET = 5;
    uint256 private constant SIG_LENGTH = 66;

    // Custom errors.
    error InvalidPayloadId(uint8 parsedPayloadId, uint8 expectedPayloadId);
    error InvalidPayloadLength(uint256 parsedLength, uint256 expectedLength);

    struct Fill {
        uint16 sourceChain;
        bytes32 orderSender;
        bytes32 redeemer;
        bytes redeemerMessage;
    }

    struct FastFill {
        uint64 fillAmount;
        Fill fill;
    }

    struct FastMarketOrder {
        uint64 amountIn;
        uint64 minAmountOut;
        uint16 targetChain;
        bytes32 redeemer;
        bytes32 sender;
        bytes32 refundAddress;
        uint64 maxFee;
        uint64 initAuctionFee;
        uint32 deadline;
        bytes redeemerMessage;
    }

    struct SlowOrderResponse {
        uint64 baseFee;
    }

    function encode(Fill memory fill) internal pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(
            FILL,
            fill.sourceChain,
            fill.orderSender,
            fill.redeemer,
            _encodeBytes(fill.redeemerMessage)
        );
    }

    function decodeFill(bytes memory encoded) internal pure returns (Fill memory fill) {
        uint256 offset = _checkPayloadId(encoded, 0, FILL);

        (fill.sourceChain, offset) = encoded.asUint16Unchecked(offset);
        (fill.orderSender, offset) = encoded.asBytes32Unchecked(offset);
        (fill.redeemer, offset) = encoded.asBytes32Unchecked(offset);
        (fill.redeemerMessage, offset) = _decodeBytes(encoded, offset);

        _checkLength(encoded, offset);
    }

    function encode(FastMarketOrder memory order) internal pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(
            FAST_MARKET_ORDER,
            order.amountIn,
            order.minAmountOut,
            order.targetChain,
            order.redeemer,
            order.sender,
            order.refundAddress,
            order.maxFee,
            order.initAuctionFee,
            order.deadline,
            _encodeBytes(order.redeemerMessage)
        );
    }

    function decodeFastMarketOrder(bytes memory encoded)
        internal
        pure
        returns (FastMarketOrder memory order)
    {
        uint256 offset = _checkPayloadId(encoded, 0, FAST_MARKET_ORDER);

        // Parse the encoded message.
        (order.amountIn, offset) = encoded.asUint64Unchecked(offset);
        (order.minAmountOut, offset) = encoded.asUint64Unchecked(offset);
        (order.targetChain, offset) = encoded.asUint16Unchecked(offset);
        (order.redeemer, offset) = encoded.asBytes32Unchecked(offset);
        (order.sender, offset) = encoded.asBytes32Unchecked(offset);
        (order.refundAddress, offset) = encoded.asBytes32Unchecked(offset);
        (order.maxFee, offset) = encoded.asUint64Unchecked(offset);
        (order.initAuctionFee, offset) = encoded.asUint64Unchecked(offset);
        (order.deadline, offset) = encoded.asUint32Unchecked(offset);
        (order.redeemerMessage, offset) = _decodeBytes(encoded, offset);

        _checkLength(encoded, offset);
    }

    function encode(FastFill memory fastFill) internal pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(
            FAST_FILL,
            fastFill.fillAmount,
            fastFill.fill.sourceChain,
            fastFill.fill.orderSender,
            fastFill.fill.redeemer,
            _encodeBytes(fastFill.fill.redeemerMessage)
        );
    }

    function decodeFastFill(bytes memory encoded)
        internal
        pure
        returns (FastFill memory fastFill)
    {
        uint256 offset = _checkPayloadId(encoded, 0, FAST_FILL);

        // Parse the encoded message.
        (fastFill.fillAmount, offset) = encoded.asUint64Unchecked(offset);
        (fastFill.fill.sourceChain, offset) = encoded.asUint16Unchecked(offset);
        (fastFill.fill.orderSender, offset) = encoded.asBytes32Unchecked(offset);
        (fastFill.fill.redeemer, offset) = encoded.asBytes32Unchecked(offset);
        (fastFill.fill.redeemerMessage, offset) = _decodeBytes(encoded, offset);

        _checkLength(encoded, offset);
    }

    function encode(SlowOrderResponse memory response)
        internal
        pure
        returns (bytes memory encoded)
    {
        encoded = abi.encodePacked(SLOW_ORDER_RESPONSE, response.baseFee);
    }

    function decodeSlowOrderResponse(bytes memory encoded)
        internal
        pure
        returns (SlowOrderResponse memory response)
    {
        uint256 offset = _checkPayloadId(encoded, 0, SLOW_ORDER_RESPONSE);

        // Parse the encoded message.
        (response.baseFee, offset) = encoded.asUint64Unchecked(offset);

        _checkLength(encoded, offset);
    }

    // ---------------------------------------- private -------------------------------------------

    function _decodeBytes(bytes memory encoded, uint256 startOffset)
        private
        pure
        returns (bytes memory payload, uint256 offset)
    {
        uint32 payloadLength;
        (payloadLength, offset) = encoded.asUint32Unchecked(startOffset);
        (payload, offset) = encoded.sliceUnchecked(offset, payloadLength);
    }

    function _encodeBytes(bytes memory payload) private pure returns (bytes memory encoded) {
        // Casting payload.length to uint32 is safe because you'll be hard-pressed
        // to allocate 4 GB of EVM memory in a single transaction.
        encoded = abi.encodePacked(uint32(payload.length), payload);
    }

    function _checkLength(bytes memory encoded, uint256 expected) private pure {
        if (encoded.length != expected) {
            revert InvalidPayloadLength(encoded.length, expected);
        }
    }

    function _checkPayloadId(bytes memory encoded, uint256 startOffset, uint8 expectedPayloadId)
        private
        pure
        returns (uint256 offset)
    {
        uint8 parsedPayloadId;
        (parsedPayloadId, offset) = encoded.asUint8Unchecked(startOffset);
        if (parsedPayloadId != expectedPayloadId) {
            revert InvalidPayloadId(parsedPayloadId, expectedPayloadId);
        }
    }

    // ---------------------------------- Unsafe VAA Parsing --------------------------------------

    function unsafeEmitterChainFromVaa(bytes memory encoded) internal pure returns (uint16) {
        // Skip the payload ID and guardian set index.
        (uint256 numSignatures, uint256 offset) = encoded.asUint8Unchecked(SIG_COUNT_OFFSET);
        (uint16 emitterChain,) = encoded.asUint16Unchecked(offset + SIG_LENGTH * numSignatures + 8);
        return emitterChain;
    }

    function unsafeEmitterAddressFromVaa(bytes memory encoded) internal pure returns (bytes32) {
        // Skip the payload ID and guardian set index.
        (uint256 numSignatures, uint256 offset) = encoded.asUint8Unchecked(SIG_COUNT_OFFSET);
        (bytes32 emitterAddress,) =
            encoded.asBytes32Unchecked(offset + SIG_LENGTH * numSignatures + 10);
        return emitterAddress;
    }

    function unsafeSequenceFromVaa(bytes memory encoded) internal pure returns (uint64) {
        // Skip the payload ID and guardian set index.
        (uint256 numSignatures, uint256 offset) = encoded.asUint8Unchecked(SIG_COUNT_OFFSET);
        (uint64 sequence,) = encoded.asUint64Unchecked(offset + SIG_LENGTH * numSignatures + 42);
        return sequence;
    }

    function unsafeVaaKeyFromVaa(bytes memory encoded)
        internal
        pure
        returns (uint32, uint16, bytes32, uint64)
    {
        // Skip the payload ID and guardian set index.
        (uint256 numSignatures, uint256 offset) = encoded.asUint8Unchecked(SIG_COUNT_OFFSET);

        uint256 bodyIndex = offset + SIG_LENGTH * numSignatures;
        (uint32 timestamp,) = encoded.asUint32Unchecked(bodyIndex);
        (uint16 emitterChain,) = encoded.asUint16Unchecked(bodyIndex + 8);
        (bytes32 emitterAddress,) = encoded.asBytes32Unchecked(bodyIndex + 10);
        (uint64 sequence,) = encoded.asUint64Unchecked(bodyIndex + 42);

        return (timestamp, emitterChain, emitterAddress, sequence);
    }
}
