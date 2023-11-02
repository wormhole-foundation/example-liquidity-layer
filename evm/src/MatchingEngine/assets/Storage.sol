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

struct AuctionData {
    uint128 startBlock;
    uint128 bidPrice;
    address bidder;
    uint16 sourceChain;
    uint64 slowSequence;
    bytes32 sourceRouter;
}

struct AuctionInfo {
    mapping(bytes32 vmHash => AuctionData data) auctions;
}

// keccak256("AuctionInfo") - 1
bytes32 constant AUCTION_INFO_STORAGE_SLOT = 0x19a5671aa715beae8ca8e3276cd84c5ad56586ae71b06cc98cfa0aee85e37e9c;

function getAuctionInfo() pure returns (AuctionInfo storage state) {
    assembly ("memory-safe") {
        state.slot := AUCTION_INFO_STORAGE_SLOT
    }
}