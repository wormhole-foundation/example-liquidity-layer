// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "../shared/Messages.sol";

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

interface IMatchingEngineFastOrders {
    function placeInitialBid(bytes calldata fastTransferVaa, uint128 feeBid) external;

    function improveBid(bytes32 auctionId, uint128 feeBid) external;

    function executeFastOrder(bytes calldata fastTransferVaa)
        external
        payable
        returns (uint64 sequence);

    function executeSlowOrderAndRedeem(
        bytes calldata fastFillVaa,
        ICircleIntegration.RedeemParameters calldata params
    ) external payable returns (uint64 sequence);

    function redeemFastFill(bytes calldata fastFillVaa)
        external
        returns (Messages.FastFill memory);

    function calculateDynamicPenalty(uint256 amount, uint256 blocksElapsed)
        external
        pure
        returns (uint256, uint256);

    function calculateDynamicPenalty(bytes32 auctionId) external view returns (uint256, uint256);
}
