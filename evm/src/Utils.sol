// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

function toUniversalAddress(address evmAddr) pure returns (bytes32) {
	return bytes32(uint256(uint160(evmAddr)));
}

function fromUniversalAddress(bytes32 universalAddr) pure returns (address) {
	return address(uint160(uint256(universalAddr)));
}
