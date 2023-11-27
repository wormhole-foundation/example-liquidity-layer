// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {FastTransferParameters} from "./ITokenRouterTypes.sol";

interface ITokenRouterAdmin {
    /**
     * @notice Add a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @param router The `router` address in Wormhole universal format.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function addRouterEndpoint(uint16 chain, bytes32 router) external;

    /**
     * @notice Update the fast transfer parameters.
     * @param newParams The new fast transfer parameters.
     * - `feeInBps` - The fast transfer fee in basis points.
     * - `maxAmount` - The maximum amount that can be transferred using fast transfers.
     * - `baseFee` - The `baseFee` which is summed with the `feeInBps` to calculate the total fee.
     * - `initAuctionFee` - The fee paid to the initial bidder of an auction.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function updateFastTransferParameters(FastTransferParameters memory newParams) external;

    /**
     * @notice Disables fast transfers by setting the `feeInBps` to 0.
     */
    function disableFastTransfers() external;
}
