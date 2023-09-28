// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

library Messages {
	using BytesParsing for bytes;

	uint8 private constant MARKET_ORDER = 0x1;
	uint8 private constant FILL = 0x10;

	// Custom errors.
	error InvalidPayloadId(uint8 parsedPayloadId, uint8 expectedPayloadId);
	error InvalidPayloadLength(uint256 parsedLength, uint256 expectedLength);

	struct MarketOrder {
		uint256 minAmountOut;
		uint16 targetChain;
		bytes32 redeemer;
		bytes redeemerMessage;
		bytes32 sender;
		bytes32 refundAddress;
		uint256 relayerFee;
		bytes32[] allowedRelayers;
	}

	struct Fill {
		bytes32 orderSender;
		bytes32 redeemer;
		bytes redeemerMessage;
	}

	struct OrderRevert {
		uint8 reason;
		bytes32 refundAddress;
	}

	function encode(MarketOrder memory order) internal pure returns (bytes memory encoded) {
		encoded = abi.encodePacked(
			MARKET_ORDER,
			order.minAmountOut,
			order.targetChain,
			order.redeemer,
			order.sender,
			order.refundAddress,
			order.relayerFee,
			uint8(order.allowedRelayers.length),
			abi.encodePacked(order.allowedRelayers),
			encodeBytes(order.redeemerMessage)
		);
	}

	function decodeMarketOrder(
		bytes memory encoded
	) internal pure returns (MarketOrder memory order) {
		uint256 offset = checkPayloadId(encoded, 0, MARKET_ORDER);

		// Parse the encoded message.
		(order.minAmountOut, offset) = encoded.asUint256Unchecked(offset);
		(order.targetChain, offset) = encoded.asUint16Unchecked(offset);
		(order.redeemer, offset) = encoded.asBytes32Unchecked(offset);
		(order.sender, offset) = encoded.asBytes32Unchecked(offset);
		(order.refundAddress, offset) = encoded.asBytes32Unchecked(offset);
		(order.relayerFee, offset) = encoded.asUint256Unchecked(offset);
		(order.allowedRelayers, offset) = decodeAllowedRelayers(encoded, offset);
		(order.redeemerMessage, offset) = decodeBytes(encoded, offset);

		checkLength(encoded, offset);
	}

	function decodeAllowedRelayers(
		bytes memory encoded,
		uint256 startOffset
	) internal pure returns (bytes32[] memory allowedRelayers, uint256 offset) {
		uint8 relayerCount;
		(relayerCount, offset) = encoded.asUint8Unchecked(startOffset);

		allowedRelayers = new bytes32[](relayerCount);
		for (uint256 i = 0; i < relayerCount; ) {
			(allowedRelayers[i], offset) = encoded.asBytes32Unchecked(offset);
			unchecked {
				++i;
			}
		}
	}

	function decodeFill(bytes memory encoded) internal pure returns (Fill memory fill) {
		uint256 offset = checkPayloadId(encoded, 0, FILL);

		(fill.orderSender, offset) = encoded.asBytes32Unchecked(offset);
		(fill.redeemer, offset) = encoded.asBytes32Unchecked(offset);
		(fill.redeemerMessage, offset) = decodeBytes(encoded, offset);

		checkLength(encoded, offset);
	}

	function decodeWormholeTimestamp(bytes memory encoded) internal pure returns (uint256) {
		// Skip the payload ID and guardian set index.
		(uint256 numSignatures, uint256 offset) = encoded.asUint8Unchecked(5);
		(uint32 timestamp, ) = encoded.asUint32Unchecked(offset + 66 * numSignatures);
		return uint256(timestamp);
	}

	// ------------------------------------------ private --------------------------------------------

	function decodeBytes(
		bytes memory encoded,
		uint256 startOffset
	) private pure returns (bytes memory payload, uint256 offset) {
		uint32 payloadLength;
		(payloadLength, offset) = encoded.asUint32Unchecked(startOffset);
		(payload, offset) = encoded.sliceUnchecked(offset, payloadLength);
	}

	function encodeBytes(bytes memory payload) private pure returns (bytes memory encoded) {
		// Casting payload.length to uint32 is safe because you'll be hard-pressed
		// to allocate 4 GB of EVM memory in a single transaction.
		encoded = abi.encodePacked(uint32(payload.length), payload);
	}

	function checkLength(bytes memory encoded, uint256 expected) private pure {
		if (encoded.length != expected) {
			revert InvalidPayloadLength(encoded.length, expected);
		}
	}

	function checkPayloadId(
		bytes memory encoded,
		uint256 startOffset,
		uint8 expectedPayloadId
	) private pure returns (uint256 offset) {
		uint8 parsedPayloadId;
		(parsedPayloadId, offset) = encoded.asUint8Unchecked(startOffset);
		if (parsedPayloadId != expectedPayloadId) {
			revert InvalidPayloadId(parsedPayloadId, expectedPayloadId);
		}
	}
}
