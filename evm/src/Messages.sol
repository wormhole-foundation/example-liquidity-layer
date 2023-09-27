// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

library Messages {
	uint8 private constant MARKET_ORDER = 1;

	struct MarketOrder {
		uint256 minAmountOut;
		uint16 targetChain;
		bytes32 redeemer;
		bytes redeemerMessage;
		uint256 relayerFee;
		bytes32[] allowedRelayers;
	}

	struct Fill {
		uint256 amount;
		bytes32 redeemer;
		bytes redeemerMessage;
	}

	function encode(
		MarketOrder memory strct
	) internal pure returns (bytes memory encoded) {
		encoded = abi.encodePacked(
			MARKET_ORDER,
			strct.minAmountOut,
			strct.targetChain,
			strct.redeemer,
			strct.relayerFee,
			uint8(strct.allowedRelayers.length),
			abi.encodePacked(strct.allowedRelayers),
			encodeBytes(strct.redeemerMessage)
		);
	}

	function encodeBytes(
		bytes memory payload
	) private pure returns (bytes memory encoded) {
		//casting payload.length to uint32 is safe because you'll be hard-pressed to allocate 4 GB of
		//  EVM memory in a single transaction
		encoded = abi.encodePacked(uint32(payload.length), payload);
	}
}
