// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Messages} from "../Messages.sol";

import {PlaceMarketOrder} from "./PlaceMarketOrder.sol";

contract OrderRouter is PlaceMarketOrder {
	using BytesParsing for bytes;
	using Messages for *;

	constructor(
		address _token,
		uint16 _matchingEngineChain,
		bytes32 _matchingEngineEndpoint,
		uint16 _canonicalTokenChain,
		bytes32 _canonicalTokenAddress,
		address _tokenBridge,
		address _wormholeCircle
	)
		PlaceMarketOrder(
			_token,
			_matchingEngineChain,
			_matchingEngineEndpoint,
			_canonicalTokenChain,
			_canonicalTokenAddress,
			_tokenBridge,
			_wormholeCircle
		)
	{}
}
