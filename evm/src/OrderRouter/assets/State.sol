// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import "./Errors.sol";
import {getRedeemedFills, getRouterInfos} from "./Storage.sol";

import {RouterInfo, TokenType} from "../../interfaces/Types.sol";

abstract contract State {
	uint24 public constant MIN_SLIPPAGE = 100; // 1.00 bps
	uint24 public constant MAX_SLIPPAGE = 1000000; // 10,000.00 bps (100%)

	uint256 public constant MAX_AMOUNT = 2 ** (256 - 24) - 1;

	IERC20 public immutable orderToken;

	uint16 public immutable matchingEngineChain;
	bytes32 public immutable matchingEngineEndpoint;

	uint16 public immutable canonicalTokenChain;
	bytes32 public immutable canonicalTokenAddress;

	ITokenBridge public immutable tokenBridge;

	ICircleIntegration public immutable wormholeCctp;

	uint16 public immutable wormholeChain;
	TokenType public immutable tokenType;

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
		wormholeCctp = ICircleIntegration(_wormholeCctp);

		wormholeChain = tokenBridge.wormhole().chainId();

		// This needs to be a ternary because immutable variables cannot be assigned in a
		// conditional.
		tokenType = _wormholeCctp != address(0)
			? TokenType.Cctp
			: (
				_token == tokenBridge.wrappedAsset(_canonicalTokenChain, _canonicalTokenAddress)
					? TokenType.Canonical
					: TokenType.Native
			);
	}

	function getRouterInfo(uint16 chain) external view returns (RouterInfo memory info) {
		info = getRouterInfos().infos[chain];

		// Target chain must be registered with the order router.
		if (info.tokenType == TokenType.Unset) {
			revert ErrUnsupportedChain(chain);
		}
	}

	function isFillRedeemed(bytes32 fillHash) external view returns (bool) {
		return getRedeemedFills().redeemed[fillHash];
	}
}
