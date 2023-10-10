// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";

// -------------------------------------- Persistent Storage ---------------------------------------

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

struct Implementation {
    mapping(address => bool) isInitialized;
}

// keccak256("InitializedImplementations") - 1
bytes32 constant IMPLEMENTATION_STORAGE_SLOT = 0x03c884046453e4665e8c45126546799c73dad598a4bcca7e00f0c13eaa1ae299;

function getImplementationState() pure returns (Implementation storage state) {
    assembly ("memory-safe") {
        state.slot := IMPLEMENTATION_STORAGE_SLOT
    }
}

/**
 * @dev This contract is shared between the `MatchingEngine` and `OrderRouter` contracts.
 */
abstract contract Admin is ERC1967Upgrade {
    // Errors.
    error InvalidAddress();
    error NotTheOwner();
    error NotPendingOwner();
    error ContractPaused();

    // Events.
    event OwnershipTransfered(address indexed oldOwner, address indexed newOwner);
    event IsPaused(bool paused);

    constructor() {
        getOwnerState().owner = msg.sender;
    }

    function setPause(bool paused) external onlyOwner {
        emit IsPaused(paused);
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
