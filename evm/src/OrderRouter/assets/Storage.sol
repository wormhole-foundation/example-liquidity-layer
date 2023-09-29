// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {TargetInfo, TargetType} from "../../interfaces/Types.sol";

struct RedeemedFills {
	mapping(bytes32 => bool) redeemedFills;
}

// keccak256("RedeemedFills") - 1
bytes32 constant REDEEMED_FILLS_STORAGE_SLOT = 0x352d8fd77503ce3838344806bbc0bcc9186b7482d350b5c411064a28d97f2ce6;

function getRedeemedFills() pure returns (RedeemedFills storage state) {
	assembly ("memory-safe") {
		state.slot := REDEEMED_FILLS_STORAGE_SLOT
	}
}

struct TargetInfos {
	mapping(uint16 => TargetInfo) targetInfos;
}

// keccak256("TargetInfos") - 1
bytes32 constant TARGET_INFOS_STORAGE_SLOT = 0x6a5f07b9c4483f1037b08865ccc880010dee12edabf2758c4e914ce80b9df3ac;

function getTargetInfos() pure returns (TargetInfos storage state) {
	assembly ("memory-safe") {
		state.slot := TARGET_INFOS_STORAGE_SLOT
	}
}

struct Endpoints {
	mapping(uint16 => bytes32) endpoints;
}

// keccak256("Endpoints") - 1
bytes32 constant ENDPOINTS_STORAGE_SLOT = 0x62083ee23257c2bf0e740c4f1fb492a7e4547572f85b2ddfcdbbbff3dead0c09;

function getEndpoints() pure returns (Endpoints storage state) {
	assembly ("memory-safe") {
		state.slot := ENDPOINTS_STORAGE_SLOT
	}
}
