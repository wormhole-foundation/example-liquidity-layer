// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

enum TokenType {
	Unset,
	Native,
	Canonical,
	Cctp
}

struct TargetInfo {
	TokenType tokenType;
	uint248 slippage; // TODO: re-evaluate
}
