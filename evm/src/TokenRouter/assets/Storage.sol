// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 => bytes32) endpoints;
}

// keccak256("RouterEndpoints") - 1
bytes32 constant ROUTER_ENDPOINT_STORAGE_SLOT = 0x3627fcf6b5d29b232a423d0b586326756a413529bc2286eb687a1a7d4123d9ff;

/**
 * @notice Returns the `RouterEndpoints` storage slot.
 */
function getRouterEndpoint() pure returns (RouterEndpoints storage state) {
    assembly ("memory-safe") {
        state.slot := ROUTER_ENDPOINT_STORAGE_SLOT
    }
}