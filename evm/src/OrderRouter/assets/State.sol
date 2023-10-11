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

    uint256 public constant MAX_AMOUNT = (2 ** 256 - 1) / MAX_SLIPPAGE;

    IERC20 immutable _orderToken;

    uint16 immutable _matchingEngineChain;
    bytes32 immutable _matchingEngineEndpoint;

    uint16 immutable _canonicalTokenChain;
    bytes32 immutable _canonicalTokenAddress;

    ITokenBridge immutable _tokenBridge;

    ICircleIntegration immutable _wormholeCctp;

    uint16 immutable _wormholeChainId;
    TokenType immutable _tokenType;

    constructor(
        address token_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineEndpoint_,
        uint16 canonicalTokenChain_,
        bytes32 canonicalTokenAddress_,
        address tokenBridge_,
        address wormholeCctp_
    ) {
        _orderToken = IERC20(token_);

        _matchingEngineChain = matchingEngineChain_;
        _matchingEngineEndpoint = matchingEngineEndpoint_;

        _canonicalTokenChain = canonicalTokenChain_;
        _canonicalTokenAddress = canonicalTokenAddress_;

        _tokenBridge = ITokenBridge(tokenBridge_);
        _wormholeCctp = ICircleIntegration(wormholeCctp_);

        _wormholeChainId = _tokenBridge.wormhole().chainId();

        // This needs to be a ternary because immutable variables cannot be assigned in a
        // conditional.
        _tokenType = wormholeCctp_ != address(0)
            ? TokenType.Cctp
            : (
                token_ == _tokenBridge.wrappedAsset(canonicalTokenChain_, canonicalTokenAddress_)
                    ? TokenType.Canonical
                    : TokenType.Native
            );
    }

    function getRouterInfo(uint16 chain) public view returns (RouterInfo memory info) {
        info = getRouterInfos().infos[chain];

        // Target chain must be registered with the order router.
        if (info.tokenType == TokenType.Unset) {
            revert ErrUnsupportedChain(chain);
        }
    }

    function isFillRedeemed(bytes32 fillHash) external view returns (bool) {
        return getRedeemedFills().redeemed[fillHash];
    }

    function orderToken() external view returns (IERC20) {
        return _orderToken;
    }

    function matchingEngineChain() external view returns (uint16) {
        return _matchingEngineChain;
    }

    function matchingEngineEndpoint() external view returns (bytes32) {
        return _matchingEngineEndpoint;
    }

    function canonicalTokenChain() external view returns (uint16) {
        return _canonicalTokenChain;
    }

    function canonicalTokenAddress() external view returns (bytes32) {
        return _canonicalTokenAddress;
    }

    function tokenBridge() external view returns (ITokenBridge) {
        return _tokenBridge;
    }

    function wormholeCctp() external view returns (ICircleIntegration) {
        return _wormholeCctp;
    }

    function wormholeChainId() external view returns (uint16) {
        return _wormholeChainId;
    }

    function tokenType() external view returns (TokenType) {
        return _tokenType;
    }
}
