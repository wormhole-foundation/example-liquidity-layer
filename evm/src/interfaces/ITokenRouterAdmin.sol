// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {Endpoint, FastTransferParameters} from "./ITokenRouterTypes.sol";

interface ITokenRouterAdmin {
    /**
     * @notice Add a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @param endpoint The `Endpoint` for the specified `chain`.
     * @param domain The Circle domain for the specified `chain`.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function addRouterEndpoint(uint16 chain, Endpoint memory endpoint, uint32 domain) external;

    /**
     * @notice Update the fast transfer parameters.
     * @param newParams The new fast transfer parameters.
     * - `enable` - Determines if fast transfers are enabled.
     * - `maxAmount` - The maximum amount that can be transferred using fast transfers.
     * - `baseFee` - The `baseFee` which is summed with the `feeInBps` to calculate the total fee.
     * - `initAuctionFee` - The fee paid to the initial bidder of an auction.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function updateFastTransferParameters(FastTransferParameters memory newParams) external;

    /**
     * @notice Determines if fast transfers are enabled.
     * @param enable `true` to enable fast transfers, `false` to disable.
     */
    function enableFastTransfers(bool enable) external;

    /**
     * @notice Set the allowance for the Circle Bridge to the `amount`.
     * @param amount The allowance amount.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function setCctpAllowance(uint256 amount) external;
}
