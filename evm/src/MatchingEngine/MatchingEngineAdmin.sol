// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {Admin} from "../shared/Admin.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {CurvePoolInfo, Route, getExecutionRouteState, getCurvePoolState, getOrderRoutersState} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineAdmin is Admin {
    // Errors.
    error InvalidChainId();

    function enableExecutionRoute(
        uint16 chainId,
        address target,
        bool cctp,
        int8 poolIndex
    ) external onlyOwner {
        if (target == address(0)) {
            revert InvalidAddress();
        }

        // Update the route.
        Route storage route = getExecutionRouteState().routes[chainId];
        route.target = target;
        route.cctp = cctp;
        route.poolIndex = poolIndex;
    }

    function disableExecutionRoute(uint16 chainId) external onlyOwner {
        delete getExecutionRouteState().routes[chainId];
    }

    function registerOrderRouter(uint16 chainId, bytes32 router) external onlyOwner {
        if (router == bytes32(0)) {
            revert InvalidAddress();
        }

        if (chainId == 0) {
            revert InvalidChainId();
        }

        // Update the router address.
        getOrderRoutersState().registered[chainId] = router;
    }

    function updateCurvePool(ICurvePool pool, int8 nativeTokenIndex) external onlyOwner {
        if (address(pool) == address(0)) {
            revert InvalidAddress();
        }

        // Update the pool address.
        CurvePoolInfo storage info = getCurvePoolState();
        info.pool = pool;
        info.nativeTokenIndex = nativeTokenIndex;
    }
}
