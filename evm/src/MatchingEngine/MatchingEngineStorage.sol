// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ICurvePool} from "curve-solidity/ICurvePool.sol";

// -------------------------------------- Persistent Storage ---------------------------------------

struct Route {
    bytes32 router;
    address target;
    bool cctp;
    int8 poolIndex;
}

struct ExecutionRoutes {
    mapping(uint16 => Route) routes;
}

// keccak256("ExecutionRoutes") - 1
bytes32 constant EXECUTION_ROUTES_STORAGE_SLOT = 0x383382b5f02489edee2a4291e85847e7a56d781e3be334521545956952c8bb99;

function getExecutionRouteState() pure returns (ExecutionRoutes storage state) {
    assembly ("memory-safe") {
        state.slot := EXECUTION_ROUTES_STORAGE_SLOT
    }
}

struct CurvePoolInfo {
    ICurvePool pool;
    int8 nativeTokenIndex;
}

// keccak256("CurvePoolInfo") - 1
bytes32 constant CURVE_POOL_INFO_STORAGE_SLOT = 0x45c87bd57c20f0faa4795aea8c05a372ed0f76438e0e478daf74ed3b54b61c98;

function getCurvePoolState() pure returns (CurvePoolInfo storage state) {
    assembly ("memory-safe") {
        state.slot := CURVE_POOL_INFO_STORAGE_SLOT
    }
}

struct DefaultRelayers {
    mapping(address => bool) registered;
}

// keccak256("DefaultRelayers") - 1
bytes32 constant DEFAULT_RELAYERS_STORAGE_SLOT = 0xdec56d794f7704019d0d813066e194c34342e6d3932b08da657cbfdfb6ee8134;

function getDefaultRelayersState() pure returns (DefaultRelayers storage state) {
    assembly ("memory-safe") {
        state.slot := DEFAULT_RELAYERS_STORAGE_SLOT
    }
}
