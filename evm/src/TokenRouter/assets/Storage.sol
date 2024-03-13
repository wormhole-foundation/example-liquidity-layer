// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "src/interfaces/ITokenRouterTypes.sol";

// keccak256("RouterEndpoints") - 1
bytes32 constant ROUTER_ENDPOINT_STORAGE_SLOT =
    0x3627fcf6b5d29b232a423d0b586326756a413529bc2286eb687a1a7d4123d9ff;

/**
 * @notice Returns the `RouterEndpoints` storage slot.
 */
function getRouterEndpointState() pure returns (RouterEndpoints storage state) {
    assembly ("memory-safe") {
        state.slot := ROUTER_ENDPOINT_STORAGE_SLOT
    }
}

// keccak256("FastTransferParameters") - 1
bytes32 constant FAST_TRANSFER_PARAMETERS_STORAGE_SLOT =
    0xb1fa150fa2d3e80815752aa4c585f31e33f15929e28258e784b10ef8d0560996;

/**
 * @notice Returns the `FastTransferParameters` storage slot.
 */
function getFastTransferParametersState() pure returns (FastTransferParameters storage state) {
    assembly ("memory-safe") {
        state.slot := FAST_TRANSFER_PARAMETERS_STORAGE_SLOT
    }
}

// keccak256("CircleDomain") - 1
bytes32 constant CIRCLE_DOMAIN_STORAGE_SLOT =
    0x0776d828ae37dc9b71ac8e092e28df60d7af2771b93454a1311c33040591339b;

/**
 * @notice Returns the CircleDomains mapping.
 */
function getCircleDomainsState() pure returns (CircleDomains storage state) {
    assembly ("memory-safe") {
        state.slot := CIRCLE_DOMAIN_STORAGE_SLOT
    }
}
