// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {Admin} from "../shared/Admin.sol";
import {MatchingEngineState} from "./MatchingEngineState.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {CurvePoolInfo, Route, getExecutionRouteState, getCurvePoolState, getDefaultRelayersState} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineAdmin is MatchingEngineState, Admin {
    // Errors.
    error InvalidChainId();
    error InvalidTokenIndex();
    error CurvePoolNotSet();

    function enableExecutionRoute(
        uint16 chainId_,
        bytes32 router,
        address target,
        bool cctp,
        int8 poolIndex
    ) external onlyOwnerOrAssistant {
        if (target == address(0)) {
            revert InvalidAddress();
        }
        if (router == bytes32(0)) {
            revert InvalidAddress();
        }
        if (chainId_ == 0) {
            revert InvalidChainId();
        }

        // Fetch the curve pool address and validate the token index.
        if (chainId_ != _chainId) {
            address curvePool = getCurvePoolState().pool[chainId_];
            if (curvePool == address(0)) {
                revert CurvePoolNotSet();
            }
            if (ICurvePool(curvePool).coins(uint256(uint8(poolIndex))) != target) {
                revert InvalidTokenIndex();
            }
        }

        // Set the route.
        Route storage route = getExecutionRouteState().routes[chainId_];
        route.router = router;
        route.target = target;
        route.cctp = cctp;
        route.poolIndex = poolIndex;
    }

    function disableExecutionRoute(uint16 chainId_) external onlyOwnerOrAssistant {
        delete getExecutionRouteState().routes[chainId_];
    }

    function updateCurvePoolAddress(
        uint16 chainId_,
        address curvePool
    ) external onlyOwnerOrAssistant {
        if (curvePool == address(0)) {
            revert InvalidAddress();
        }
        if (chainId_ == 0 || chainId_ == _chainId) {
            revert InvalidChainId();
        }

        // Update the pool address.
        getCurvePoolState().pool[chainId_] = curvePool;
    }

    function updateNativePoolInfo(
        uint16 chainId_,
        int8 nativeTokenIndex,
        address nativeTokenAddress
    ) external onlyOwnerOrAssistant {
        if (chainId_ == 0) {
            revert InvalidChainId();
        }
        if (nativeTokenAddress == address(0)) {
            revert InvalidAddress();
        }

        // Update the pool address.
        CurvePoolInfo storage poolState = getCurvePoolState();
        poolState.nativeTokenIndex = nativeTokenIndex;
        poolState.nativeTokenAddress = nativeTokenAddress;
    }

    function registerDefaultRelayer(
        address relayer,
        bool shouldRegister
    ) external onlyOwnerOrAssistant {
        if (relayer == address(0)) {
            revert InvalidAddress();
        }

        getDefaultRelayersState().registered[relayer] = shouldRegister;
    }
}
