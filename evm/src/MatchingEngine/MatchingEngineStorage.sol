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

function getExecutionRouteState() pure returns (ExecutionRoutes storage state) {
	assembly ("memory-safe") {
		state.slot := EXECUTION_ROUTES_STORAGE_SLOT
	}
}

struct RegisteredOrderRouters {
	mapping(uint16 => bytes32) registered;
}

// keccak256("RegisteredOrderRouters") - 1
bytes32 constant REGISTERED_ORDER_ROUTERS_STORAGE_SLOT = 0xca8563aa1bc6c7c344236139a238fcf417d4ef764fd632968827af37204289eb;

function getOrderRoutersState() pure returns (RegisteredOrderRouters storage state) {
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

function getCurvePoolState() pure returns (CurvePoolInfo storage state) {
	assembly ("memory-safe") {
		state.slot := CURVE_POOL_INFO_STORAGE_SLOT
	}
}

struct Owner {
	address owner;
}

// keccak256("Owner") - 1
bytes32 constant OWNER_STORAGE_SLOT = 0x929f3fd6848015f83b9210c89f7744e3941acae1195c8bf9f5798c090dc8f496;

function getOwnerState() pure returns (Owner storage state) {
	assembly ("memory-safe") {
		state.slot := OWNER_STORAGE_SLOT
	}
}

struct PendingOwner {
	address pendingOwner;
}

// keccak256("PendingOwner") - 1
bytes32 constant PENDING_OWNER_STORAGE_SLOT = 0xfc082288390448db0c2ef4784346b98f672a76b4728a0683ba90c0ca79ea5128;

function getPendingOwnerState() pure returns (PendingOwner storage state) {
	assembly ("memory-safe") {
		state.slot := PENDING_OWNER_STORAGE_SLOT
	}
}

struct Paused {
	bool paused;
}

// keccak256("Paused") - 1
bytes32 constant PAUSED_STORAGE_SLOT = 0x0eeb5248cf3d8cd81a5ba6d3cc6e1997df7b174eb894aac081867c1a2bc43c8f;

function getPausedState() pure returns (Paused storage state) {
	assembly ("memory-safe") {
		state.slot := PAUSED_STORAGE_SLOT
	}
}
