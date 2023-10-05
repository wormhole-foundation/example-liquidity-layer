// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {RouterInfo, TokenType} from "../../interfaces/Types.sol";

struct RedeemedFills {
    mapping(bytes32 => bool) redeemed;
}

// keccak256("RedeemedFills") - 1
bytes32 constant REDEEMED_FILLS_STORAGE_SLOT = 0x352d8fd77503ce3838344806bbc0bcc9186b7482d350b5c411064a28d97f2ce6;

function getRedeemedFills() pure returns (RedeemedFills storage state) {
    assembly ("memory-safe") {
        state.slot := REDEEMED_FILLS_STORAGE_SLOT
    }
}

struct RouterInfos {
    mapping(uint16 => RouterInfo) infos;
}

// keccak256("RouterInfos") - 1
bytes32 constant ROUTER_INFOS_STORAGE_SLOT = 0x84e23c7674e920b09745ee29fa732c2d9b4a42de483f834495405230c47214e7;

function getRouterInfos() pure returns (RouterInfos storage state) {
    assembly ("memory-safe") {
        state.slot := ROUTER_INFOS_STORAGE_SLOT
    }
}
