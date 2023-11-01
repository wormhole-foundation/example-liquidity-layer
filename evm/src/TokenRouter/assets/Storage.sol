// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 chain => bytes32 endpoint) endpoints;
}

// keccak256("RouterEndpoints") - 1
bytes32 constant ROUTER_ENDPOINT_STORAGE_SLOT = 0x3627fcf6b5d29b232a423d0b586326756a413529bc2286eb687a1a7d4123d9ff;

/**
 * @notice Returns the `RouterEndpoints` storage slot.
 */
function getRouterEndpointState() pure returns (RouterEndpoints storage state) {
    assembly ("memory-safe") {
        state.slot := ROUTER_ENDPOINT_STORAGE_SLOT
    }
}

struct FastTransferParameters {
    uint24 feeInBps;
    uint104 baseFee;
    uint128 maxAmount;
}

// keccak256("FastTransferParameters") - 1
bytes32 constant FAST_TRANSFER_PARAMETERS_STORAGE_SLOT = 0xb1fa150fa2d3e80815752aa4c585f31e33f15929e28258e784b10ef8d0560996;

/**
 * @notice Returns the `FastTransferParameters` storage slot.
 */
function getFastTransferParametersState() pure returns (FastTransferParameters storage state) {
    assembly ("memory-safe") {
        state.slot := FAST_TRANSFER_PARAMETERS_STORAGE_SLOT
    }
}