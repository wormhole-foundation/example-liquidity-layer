// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct CctpMessage {
    // Message emitted by the CCTP contract when burning USDC.
    bytes circleBridgeMessage;
    // Attestation created by the CCTP off-chain process, which is needed to mint USDC.
    bytes circleAttestation;
}

struct FeeRecipient {
    // The address that receives the `baseFee` for relaying `SlowOrderResponse` messages.
    address recipient;
}

struct RouterEndpoint {
    bytes32 router;
    bytes32 mintRecipient;
}

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 chain => RouterEndpoint endpoint) endpoints;
}

enum AuctionStatus {
    None,
    Active,
    Completed
}

struct LiveAuctionData {
    // The auction status.
    AuctionStatus status;
    // The highest bidder of the auction.
    address highestBidder;
    // The initial bidder of the auction.
    address initialBidder;
    // The block number at which the auction started.
    uint64 startBlock;
    // The amount of tokens to be sent to the user.
    uint64 amount;
    // The additional deposit made by the highest bidder.
    uint64 securityDeposit;
    // The bid price of the highest bidder.
    uint64 bidPrice;
}

struct LiveAuctionInfo {
    // Mapping of Fast Order VAA hash to `LiveAuctionData`.
    mapping(bytes32 auctionId => LiveAuctionData data) auctions;
}

struct FastFills {
    // Mapping of VAA hash to redemption status.
    mapping(bytes32 vaaHash => bool redeemed) redeemed;
}

struct CircleDomains {
    // Mapping of chain ID to Circle domain.
    mapping(uint16 chain => uint32 domain) domains;
}
