// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./IMarketMakerTypes.sol";

interface IMarketMaker {
    function updateAuctionStatus(
        bytes32 auctionId,
        uint64 totalPenalty,
        uint64 additionalFee,
        Callback callbackType
    ) external;
}
