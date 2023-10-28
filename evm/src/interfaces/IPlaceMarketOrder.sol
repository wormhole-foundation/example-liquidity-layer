// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct PlaceMarketOrderArgs {
    uint256 amountIn;
    uint256 minAmountOut;
    uint16 targetChain;
    bytes32 redeemer;
    bytes redeemerMessage;
    address refundAddress;
}

interface IPlaceMarketOrder {
    function placeMarketOrder(
        PlaceMarketOrderArgs calldata args
    ) external payable returns (uint64 sequence);
}
