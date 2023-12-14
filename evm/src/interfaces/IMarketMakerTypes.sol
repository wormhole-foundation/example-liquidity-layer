// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct Vault {
    uint24 performanceFeeBps;
    uint24 maxUtilizationRatioBps;
    uint64 fees;
    uint128 deposits;
    uint128 outstanding;
}

struct Deposit {
    uint64 totalFees;
    uint64 accruedFees;
    uint128 amount;
}

struct Auction {
    uint128 amount;
    uint64 auctionFee;
    uint64 securityDeposit;
    uint64 returnedDeposit;
    bool wonAuction;
    bool fundsReturned;
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
