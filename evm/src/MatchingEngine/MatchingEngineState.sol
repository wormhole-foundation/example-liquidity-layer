// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {getPendingOwnerState, getOwnerState, getOwnerAssistantState, getPausedState} from "../shared/Admin.sol";
import {getExecutionRouteState, Route, getCurvePoolState, getDefaultRelayersState} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineState {
    // Immutable state.
    uint16 public immutable _chainId;
    IWormhole immutable _wormhole;
    ITokenBridge immutable _tokenBridge;
    ICircleIntegration immutable _circleIntegration;

    // Consts.
    uint256 public constant RELAY_TIMEOUT = 1800; // seconds
    uint32 constant NONCE = 0;

    constructor(address wormholeTokenBridge, address wormholeCCTPBridge) {
        assert(wormholeTokenBridge != address(0));
        assert(wormholeCCTPBridge != address(0));

        _tokenBridge = ITokenBridge(wormholeTokenBridge);
        _circleIntegration = ICircleIntegration(wormholeCCTPBridge);
        _chainId = _tokenBridge.chainId();
        _wormhole = _tokenBridge.wormhole();
    }

    function chainId() external view returns (uint16) {
        return _chainId;
    }

    function wormhole() external view returns (IWormhole) {
        return _wormhole;
    }

    function tokenBridge() external view returns (ITokenBridge) {
        return _tokenBridge;
    }

    function circleIntegration() external view returns (ICircleIntegration) {
        return _circleIntegration;
    }

    function isDefaultRelayer(address relayer) external view returns (bool) {
        return getDefaultRelayersState().registered[relayer];
    }

    function getExecutionRoute(uint16 chainId_) external view returns (Route memory) {
        return getExecutionRouteState().routes[chainId_];
    }

    function getOrderRouter(uint16 chainId_) external view returns (bytes32) {
        return getExecutionRouteState().routes[chainId_].router;
    }

    function getCurvePoolAddress(uint16 chainId_) external view returns (address) {
        return getCurvePoolState().pool[chainId_];
    }

    function getCCTPIndex() external view returns (int128) {
        return int128(getCurvePoolState().nativeTokenIndex);
    }

    function getNativeTokenAddress() external view returns (address) {
        return getCurvePoolState().nativeTokenAddress;
    }

    function owner() external view returns (address) {
        return getOwnerState().owner;
    }

    function ownerAssistant() external view returns (address) {
        return getOwnerAssistantState().ownerAssistant;
    }

    function pendingOwner() external view returns (address) {
        return getPendingOwnerState().pendingOwner;
    }

    function isPaused() external view returns (bool) {
        return getPausedState().paused;
    }
}