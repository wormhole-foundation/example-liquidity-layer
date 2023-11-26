// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

struct FeeRecipient {
    address recipient;
}

// keccak256("FeeRecipient") - 1
bytes32 constant FEE_RECIPIENT_STORAGE_SLOT =
    0x8743f91cd3aa128615946fad71e2f5cfe95e4c35cccb2afbc7ecaa9a9b7f137f;

function getFeeRecipientState() pure returns (FeeRecipient storage state) {
    assembly ("memory-safe") {
        state.slot := FEE_RECIPIENT_STORAGE_SLOT
    }
}

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 chain => bytes32 endpoint) endpoints;
}

// keccak256("RouterEndpoints") - 1
bytes32 constant ROUTER_ENDPOINT_STORAGE_SLOT =
    0x3627fcf6b5d29b232a423d0b586326756a413529bc2286eb687a1a7d4123d9ff;

function getRouterEndpointState() pure returns (RouterEndpoints storage state) {
    assembly ("memory-safe") {
        state.slot := ROUTER_ENDPOINT_STORAGE_SLOT
    }
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
    mapping(bytes32 auctionId => LiveAuctionData data) auctions;
}

// keccak256("LiveAuctionInfo") - 1
bytes32 constant LIVE_AUCTION_INFO_STORAGE_SLOT =
    0x18c32f0e31dd215bbecc21bc81c00cdff3cf52fdbe43432c8c0922334994dee1;

function getLiveAuctionInfo() pure returns (LiveAuctionInfo storage state) {
    assembly ("memory-safe") {
        state.slot := LIVE_AUCTION_INFO_STORAGE_SLOT
    }
}

struct FastFills {
    // Mapping of VAA hash to redemption status.
    mapping(bytes32 vaaHash => bool redeemed) redeemed;
}

// keccak256("FastFills") - 1
bytes32 constant TRANSFER_RECEIPTS_STORAGE_SLOT =
    0xe58c46ab8c228ca315cb45e78f52803122060218943a20abb9ffec52c71706cc;

function getFastFillsState() pure returns (FastFills storage state) {
    assembly ("memory-safe") {
        state.slot := TRANSFER_RECEIPTS_STORAGE_SLOT
    }
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

// keccak256("AuctionConfig") - 1
bytes32 constant AUCTION_CONFIG_STORAGE_SLOT =
    0xa320c769f09a94dd6faf0389ca772db7dfcc947c2488fc9922d32847a96d0c92;

function getAuctionConfig() pure returns (AuctionConfig storage state) {
    assembly ("memory-safe") {
        state.slot := AUCTION_CONFIG_STORAGE_SLOT
    }
}
