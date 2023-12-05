// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct OrderResponse {
    // Signed wormhole message.
    bytes encodedWormholeMessage;
    // Message emitted by the CCTP contract when burning USDC.
    bytes circleBridgeMessage;
    // Attestation created by the CCTP off-chain process, which is needed to mint USDC.
    bytes circleAttestation;
}

struct FastTransferParameters {
    // Determines if fast transfers are enabled.
    bool enabled;
    // The maximum amount that can be transferred using fast transfers.
    uint128 maxAmount;
    // The `baseFee` which is summed with the `feeInBps` to calculate the total fee.
    uint128 baseFee;
    // The fee paid to the initial bidder of an auction.
    uint128 initAuctionFee;
}

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 chain => bytes32 endpoint) endpoints;
}
