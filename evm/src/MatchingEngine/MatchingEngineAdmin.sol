// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {Admin} from "../shared/Admin.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {CurvePoolInfo, Route, getExecutionRouteState, getCurvePoolState, getOrderRoutersState, getDefaultRelayersState} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineAdmin is Admin {
    // Errors.
    error InvalidChainId();
    error InvalidTokenIndex();

    function enableExecutionRoute(
        uint16 chainId_,
        address target,
        bool cctp,
        int8 poolIndex
    ) external onlyOwnerOrAssistant {
        if (target == address(0)) {
            revert InvalidAddress();
        }
        if (cctp && poolIndex != getCurvePoolState().nativeTokenIndex) {
            revert InvalidTokenIndex();
        }

        // Set the route.
        Route storage route = getExecutionRouteState().routes[chainId_];
        route.target = target;
        route.cctp = cctp;
        route.poolIndex = poolIndex;
    }

    function disableExecutionRoute(uint16 chainId_) external onlyOwnerOrAssistant {
        delete getExecutionRouteState().routes[chainId_];
    }

    function registerOrderRouter(uint16 chainId_, bytes32 router) external onlyOwnerOrAssistant {
        if (router == bytes32(0)) {
            revert InvalidAddress();
        }

        if (chainId_ == 0) {
            revert InvalidChainId();
        }

        // Update the router address.
        getOrderRoutersState().registered[chainId_] = router;
    }

    function updateCurvePool(ICurvePool pool, int8 nativeTokenIndex) external onlyOwnerOrAssistant {
        if (address(pool) == address(0)) {
            revert InvalidAddress();
        }

        // Update the pool address.
        CurvePoolInfo storage info = getCurvePoolState();
        info.pool = pool;
        info.nativeTokenIndex = nativeTokenIndex;
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
