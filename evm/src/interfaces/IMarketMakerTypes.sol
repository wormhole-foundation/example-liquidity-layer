// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct CampaignParameters {
    uint24 performanceFeeBps;
    uint24 minUtilizationRatioBps;
    uint64 currentCampaign;
}

struct Campaign {
    uint64 fees;
    uint64 deposits;
    uint64 outstanding;
    uint32 startBlock;
    uint32 endBlock;
}

struct Auction {
    uint64 amount;
    uint64 auctionFee;
    uint64 securityDeposit;
    uint64 returnedDeposit;
    uint64 campaign;
    bool wonAuction;
    bool fundsReturned;
}

struct Vault {
    mapping(uint64 campaign => uint64 deposit) amount;
    uint64 positionUpdateIndex;
    uint64 totalDeposited;
    uint64 accruedFees;
}

struct TransferInfo {
    bytes32 auctionId;
    uint64 amount;
    uint64 securityDeposit;
}

enum Callback {
    Outbid,
    WonAuction,
    FeeOnly,
    AuctionComplete
}
