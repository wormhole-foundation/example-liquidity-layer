// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct FeeRecipient {
    // The address that receives the `baseFee` for relaying `SlowOrderResponse` messages.
    address recipient;
}

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 chain => bytes32 endpoint) endpoints;
}

enum AuctionStatus {
    None,
    Active,
    Completed
}

struct LiveAuctionData {
    // The auction status.
    AuctionStatus status;
    // The block number at which the auction started.
    uint88 startBlock;
    // The highest bidder of the auction.
    address highestBidder;
    // The initial bidder of the auction.
    address initialBidder;
    // The amount of tokens to be sent to the user.
    uint256 amount;
    // The additional deposit made by the highest bidder.
    uint128 securityDeposit;
    // The bid price of the highest bidder.
    uint128 bidPrice;
}

struct LiveAuctionInfo {
    // Mapping of Fast Order VAA hash to `LiveAuctionData`.
    mapping(bytes32 auctionId => LiveAuctionData data) auctions;
}

struct AuctionConfig {
    // The percentage of the penalty that is awarded to the user when the auction is completed.
    uint24 userPenaltyRewardBps;
    // The initial penalty percentage that is incurred once the grace period is over.
    uint24 initialPenaltyBps;
    // The duration of the auction in blocks.
    uint8 auctionDuration;
    // The grace period of the auction in blocks. This is the number of blocks the highest
    // bidder has to execute the fast order before incurring a penalty.
    uint8 auctionGracePeriod;
    // The `securityDeposit` decays over the `penaltyBlocks` blocks period.
    uint8 penaltyBlocks;
}

struct FastFills {
    // Mapping of VAA hash to redemption status.
    mapping(bytes32 vaaHash => bool redeemed) redeemed;
}
