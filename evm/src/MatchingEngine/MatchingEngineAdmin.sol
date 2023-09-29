// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {getOwnerState, Owner, CurvePoolInfo, Route, getExecutionRouteState, getCurvePoolState, getOrderRoutersState, getPausedState, Paused, getPendingOwnerState, PendingOwner} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineAdmin {
	// Errors.
	error InvalidAddress();
	error InvalidChainId();
	error NotTheOwner();
	error NotPendingOwner();
	error ContractPaused();

	// Events.
	event OwnershipTransfered(address indexed oldOwner, address indexed newOwner);

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

	function setPause(bool paused) external onlyOwner {
		getPausedState().paused = paused;
	}

	function submitOwnershipTransferRequest(address newOwner) external onlyOwner {
		if (newOwner == address(0)) {
			revert InvalidAddress();
		}

		getPendingOwnerState().pendingOwner = newOwner;
	}

	function cancelOwnershipTransferRequest() external onlyOwner {
		getPendingOwnerState().pendingOwner = address(0);
	}

	function confirmOwnershipTransferRequest() external {
		PendingOwner storage pending = getPendingOwnerState();
		Owner storage current = getOwnerState();

		// Cache pending owner.
		address newOwner = pending.pendingOwner;

		if (msg.sender != newOwner) {
			revert NotPendingOwner();
		}

		// cache currentOwner for Event
		address currentOwner = current.owner;

		// Set the new owner, and clear the pending owner.
		current.owner = newOwner;
		pending.pendingOwner = address(0);

		emit OwnershipTransfered(currentOwner, newOwner);
	}

	modifier onlyOwner() {
		if (getOwnerState().owner != msg.sender) {
			revert NotTheOwner();
		}
		_;
	}

	modifier notPaused() {
		if (getPausedState().paused) {
			revert ContractPaused();
		}
		_;
	}
}
