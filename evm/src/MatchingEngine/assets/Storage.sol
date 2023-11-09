// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

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
    AuctionStatus status;
    uint88 startBlock;
    address highestBidder;
    uint256 amount;
    uint128 securityDeposit;
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

struct InitialAuctionData {
    address initialBidder;
    uint16 slowChain;
    uint64 slowSequence;
    bytes32 slowEmitter;
}

struct InitialAuctionInfo {
    mapping(bytes32 auctionId => InitialAuctionData data) auctions;
}

// keccak256(InitialAuctionInfo) - 1
bytes32 constant INITIAL_AUCTION_INFO_STORAGE_SLOT =
    0x7c50e6c562fa9530af4687c4a8df815cac20a9021410cd934198cfffd9717d7c;

function getInitialAuctionInfo() pure returns (InitialAuctionInfo storage state) {
    assembly ("memory-safe") {
        state.slot := INITIAL_AUCTION_INFO_STORAGE_SLOT
    }
}

struct FastFills {
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
