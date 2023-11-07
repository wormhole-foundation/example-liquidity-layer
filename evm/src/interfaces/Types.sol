// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct OrderResponse {
    bytes encodedWormholeMessage;
    bytes circleBridgeMessage;
    bytes circleAttestation;
}

struct FastTransferParameters {
    uint24 feeInBps;
    uint128 maxAmount;
    uint128 baseFee;
    uint128 initAuctionFee;
}
