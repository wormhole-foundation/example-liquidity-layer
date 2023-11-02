// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

struct RouterEndpoints {
    // Mapping of chain ID to router address in Wormhole universal format.
    mapping(uint16 chain => bytes32 endpoint) endpoints;
}

// keccak256("RouterEndpoints") - 1
bytes32 constant ROUTER_ENDPOINT_STORAGE_SLOT = 0x3627fcf6b5d29b232a423d0b586326756a413529bc2286eb687a1a7d4123d9ff;

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
    AuctionStatus status; 
    uint88 startBlock;
    address highestBidder; 
    uint256 amount;
    uint128 maxFee;
    uint128 bidPrice; 
}

struct LiveAuctionInfo {
    mapping(bytes32 auctionId => LiveAuctionData data) auctions;
}

// TODO: recompute this slot. 
// keccak256("LiveAuctionInfo") - 1
bytes32 constant LIVE_AUCTION_INFO_STORAGE_SLOT = 0x19a5671aa715beae8ca8e3276cd84c5ad56586ae71b06cc98cfa0aee85e37e9c;

function getLiveAuctionInfo() pure returns (LiveAuctionInfo storage state) {
    assembly ("memory-safe") {
        state.slot := LIVE_AUCTION_INFO_STORAGE_SLOT
    }
}

struct InitialAuctionInfo {
    address initialBidder;
    uint16 sourceChain;
    uint64 slowSequence;
    bytes32 sourceRouter; 
}

// TODO: recompute this slot.
// keccak256(InintialAuctionInfo) - 1
bytes32 constant INITIAL_AUCTION_INFO_STORAGE_SLOT = 0xb1fa150fa2d3e80815752aa4c585f31e33f15929e28258e784b10ef8d0560996;

function getInitialAuctionInfo() pure returns (InitialAuctionInfo storage state) {
    assembly ("memory-safe") {
        state.slot := INITIAL_AUCTION_INFO_STORAGE_SLOT
    }
}