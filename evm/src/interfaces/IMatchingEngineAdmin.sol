// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {AuctionConfig} from "../MatchingEngine/assets/Storage.sol";

interface IMatchingEngineAdmin {
    /**
     * @notice Add a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @param router The `router` address in Wormhole universal format.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function addRouterEndpoint(uint16 chain, bytes32 router) external;

    /**
     * @notice Set the auction parameters.
     * @param newConfig The new auction configuration parameters.
     * - `auctionDuration` - The duration of the auction in blocks.
     * - `auctionGracePeriod` - The grace period of the auction in blocks. This is the
     * - number of blocks the highest bidder has to execute the fast order before incurring
     * - a penalty.
     * - `penaltyBlocks` - The `securityDeposit` decays over the `penaltyBlocks` blocks period.
     * - `userPenaltyRewardBps` - The percentage of the penalty that is awarded to the
     * - user when the auction is completed.
     * - `initialPenaltyBps` - The initial penalty percentage that is incurred once the
     * - grace period is over.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function setAuctionConfig(AuctionConfig calldata newConfig) external;

    /**
     * @notice Updates the `feeRecipient` state variable. This method can
     * only be executed by the owner.
     * @param newFeeRecipient Address of the new `feeRecipient`.
     */
    function updateFeeRecipient(address newFeeRecipient) external;
}
