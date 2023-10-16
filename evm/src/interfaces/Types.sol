// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

enum TokenType {
    Unset,
    Native,
    Canonical,
    Cctp
}

struct DefaultRelayerFee {
    uint256 fee;
}

struct RouterInfo {
    bytes32 endpoint;
    TokenType tokenType;
    uint24 slippage;
}

struct SlippageUpdate {
    uint16 chain;
    uint24 slippage;
}

struct OrderResponse {
    bytes encodedWormholeMessage;
    bytes circleBridgeMessage;
    bytes circleAttestation;
}
