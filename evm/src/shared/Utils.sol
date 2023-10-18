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

function normalizeAmount(uint256 amount, uint8 decimals) pure returns (uint256) {
    if (decimals > 8) {
        amount /= 10 ** (decimals - 8);
    }
    return amount;
}

function denormalizeAmount(uint256 amount, uint8 decimals) pure returns (uint256) {
    if (decimals > 8) {
        amount *= 10 ** (decimals - 8);
    }
    return amount;
}

function getDecimals(address token) view returns (uint8) {
    (, bytes memory queriedDecimals) = token.staticcall(abi.encodeWithSignature("decimals()"));
    return abi.decode(queriedDecimals, (uint8));
}

function adjustDecimalDiff(address tokenX, address tokenY, uint256 amount) view returns (uint256) {
    uint8 decimalsX = getDecimals(tokenX);
    uint8 decimalsY = getDecimals(tokenY);

    if (decimalsX > decimalsY) {
        amount /= 10 ** (decimalsX - decimalsY);
    } else if (decimalsY > decimalsX) {
        amount *= 10 ** (decimalsY - decimalsX);
    }
    return amount;
}
