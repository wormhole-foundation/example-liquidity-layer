// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct Vault {
    uint24 performanceFeeBps;
    uint24 maxUtilizationRatioBps;
    uint64 currentCampaign;
    mapping(uint64 => Campaign) campaigns;
}

struct Auction {
    uint128 amount;
    uint64 auctionFee;
    uint64 securityDeposit;
    uint64 returnedDeposit;
    bool wonAuction;
    bool fundsReturned;
}

struct Campaign {
    uint64 fees;
    uint64 deposits;
    uint64 outstanding;
    mapping(bytes32 => Auction) auctions;
}

struct Deposit {
    uint64 amount;
    uint64 campaignStart;
}

struct TransferInfo {
    bytes32 auctionId;
    uint128 amount;
    uint64 securityDeposit;
}

enum Callback {
    Outbid,
    WonAuction,
    FeeOnly,
    AuctionComplete
}
