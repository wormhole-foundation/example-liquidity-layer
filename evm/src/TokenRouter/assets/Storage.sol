// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

struct RouterEndpoints {
    mapping(uint16 => bytes32) endpoints;
}

// keccak256("RouterEndpoints") - 1
// TODO: need to recalculate the storage slot.
bytes32 constant ROUTER_ENDPOINT_STORAGE_SLOT = 0x84e23c7674e920b09745ee29fa732c2d9b4a42de483f834495405230c47214e7;

function getRouterEndpoint() pure returns (RouterEndpoints storage state) {
    assembly ("memory-safe") {
        state.slot := ROUTER_ENDPOINT_STORAGE_SLOT
    }
}