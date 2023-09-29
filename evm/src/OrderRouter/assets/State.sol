// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {getEndpoints, getRedeemedFills, getTargetInfos} from "./Storage.sol";

import {TargetInfo} from "../../interfaces/Types.sol";

abstract contract State {
	IERC20 public immutable orderToken;

	uint16 public immutable matchingEngineChain;
	bytes32 public immutable matchingEngineEndpoint;

	uint16 public immutable canonicalTokenChain;
	bytes32 public immutable canonicalTokenAddress;

	ITokenBridge public immutable tokenBridge;
	bool public immutable canonicalEnabled;

	ICircleIntegration public immutable wormholeCctp;
	bool public immutable cctpEnabled;

	uint16 public immutable orderRouterChain;

	constructor(
		address _token,
		uint16 _matchingEngineChain,
		bytes32 _matchingEngineEndpoint,
		uint16 _canonicalTokenChain,
		bytes32 _canonicalTokenAddress,
		address _tokenBridge,
		address _wormholeCctp
	) {
		orderToken = IERC20(_token);

		matchingEngineChain = _matchingEngineChain;
		matchingEngineEndpoint = _matchingEngineEndpoint;

		canonicalTokenChain = _canonicalTokenChain;
		canonicalTokenAddress = _canonicalTokenAddress;

		tokenBridge = ITokenBridge(_tokenBridge);
		canonicalEnabled =
			_token == tokenBridge.wrappedAsset(_canonicalTokenChain, _canonicalTokenAddress);

		wormholeCctp = ICircleIntegration(_wormholeCctp);
		cctpEnabled = _wormholeCctp != address(0);

		orderRouterChain = tokenBridge.wormhole().chainId();
	}

	function getEndpoint(uint16 chain) public view returns (bytes32) {
		return getEndpoints().endpoints[chain];
	}

	function getTargetInfo(uint16 chain) public view returns (TargetInfo memory) {
		return getTargetInfos().targetInfos[chain];
	}

	function isFillRedeemed(bytes32 fillHash) public view returns (bool) {
		return getRedeemedFills().redeemedFills[fillHash];
	}
}