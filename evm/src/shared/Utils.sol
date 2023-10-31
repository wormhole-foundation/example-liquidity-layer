// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

error AddressOverflow(bytes32 addr);

function toUniversalAddress(address evmAddr) pure returns (bytes32 converted) {
    assembly ("memory-safe") {
        converted := and(0xffffffffffffffffffffffffffffffffffffffff, evmAddr)
    }
}

function fromUniversalAddress(bytes32 universalAddr) pure returns (address converted) {
    if (bytes12(universalAddr) != 0) {
        revert AddressOverflow(universalAddr);
    }

    assembly ("memory-safe") {
        converted := universalAddr
    }
}
