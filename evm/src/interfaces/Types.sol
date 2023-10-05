// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

enum TokenType {
    Unset,
    Native,
    Canonical,
    Cctp
}

struct RouterInfo {
    bytes32 endpoint;
    TokenType tokenType;
    uint24 slippage; // TODO: re-evaluate
}
