// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct OrderResponse {
    bytes encodedWormholeMessage;
    bytes circleBridgeMessage;
    bytes circleAttestation;
}
