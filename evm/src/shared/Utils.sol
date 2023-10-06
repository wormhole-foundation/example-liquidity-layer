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

function unsafeEmitterChainFromVaa(bytes memory encodedVaa) pure returns (uint16 chain) {
    uint256 numSigs = uint256(uint8(encodedVaa[5]));
    // VAA Offset:
    //    1 (version)
    // +  4 (guardian set index)
    // +  1 (num signatures)
    // +  4 (timestamp)
    // +  4 (nonce)
    // -----
    // = 14
    //
    // mload uint16 (2 bytes) --> offset = 16
    assembly ("memory-safe") {
        chain := mload(add(encodedVaa, add(mul(numSigs, 66), 16)))
    }
}
