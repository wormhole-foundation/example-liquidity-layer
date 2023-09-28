// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ICurvePool} from "curve-solidity/ICurvePool.sol";

// -------------------------------------- Persistent Storage ---------------------------------------

struct Route {
	address target;
	bool cctp;
	int8 poolIndex;
}

struct ExecutionRoutes {
	mapping(uint16 => Route) routes;
}

// keccak256("ExecutionRoutes") - 1
bytes32 constant EXECUTION_ROUTES_STORAGE_SLOT = 0x383382b5f02489edee2a4291e85847e7a56d781e3be334521545956952c8bb99;

function getExecutionRoute() pure returns (ExecutionRoutes storage state) {
	assembly ("memory-safe") {
		state.slot := EXECUTION_ROUTES_STORAGE_SLOT
	}
}

struct RegisteredOrderRouters {
	mapping(uint16 => bytes32) registered;
}

// keccak256("RegisteredOrderRouters") - 1
bytes32 constant REGISTERED_ORDER_ROUTERS_STORAGE_SLOT = 0xca8563aa1bc6c7c344236139a238fcf417d4ef764fd632968827af37204289eb;

function getRegisteredOrderRouters()
	pure
	returns (RegisteredOrderRouters storage state)
{
	assembly ("memory-safe") {
		state.slot := REGISTERED_ORDER_ROUTERS_STORAGE_SLOT
	}
}

struct CurvePoolInfo {
	ICurvePool pool;
	int8 nativeTokenIndex;
}

// keccak256("CurvePoolInfo") - 1
bytes32 constant CURVE_POOL_INFO_STORAGE_SLOT = 0x45c87bd57c20f0faa4795aea8c05a372ed0f76438e0e478daf74ed3b54b61c98;

function getCurvePoolInfo() pure returns (CurvePoolInfo storage state) {
	assembly ("memory-safe") {
		state.slot := CURVE_POOL_INFO_STORAGE_SLOT
	}
}