// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

error AddressOverflow(bytes32 addr);

function toUniversalAddress(address evmAddr) pure returns (bytes32) {
    return bytes32(uint256(uint160(evmAddr)));
}

function fromUniversalAddress(bytes32 universalAddr) pure returns (address) {
    if (bytes12(universalAddr) != 0) {
        revert AddressOverflow(universalAddr);
    }
    return address(uint160(uint256(universalAddr)));
}
