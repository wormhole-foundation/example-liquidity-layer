// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

enum TargetType {
	Unset,
	Cctp,
	NonCctp,
	Canonical
}

struct TargetInfo {
	TargetType targetType;
	uint248 slippage; // TODO: re-evaluate
}
