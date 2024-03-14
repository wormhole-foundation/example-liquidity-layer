// SPDX-License-Identifier: Apache 2

import {RouterEndpoint} from "./IMatchingEngineTypes.sol";

pragma solidity ^0.8.0;

interface IMatchingEngineAdmin {
    /**
     * @notice Add a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @param endpoint The `Endpoint` for the specified `chain`.
     * @param circleDomain The Circle domain for the specified `chain`.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function addRouterEndpoint(uint16 chain, RouterEndpoint memory endpoint, uint32 circleDomain)
        external;

    /**
     * @notice Update a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @param endpoint The `Endpoint` for the specified `chain`.
     * @param circleDomain The Circle domain for the specified `chain`.
     * @dev This function is only callable by the contract owner.
     */
    function updateRouterEndpoint(uint16 chain, RouterEndpoint memory endpoint, uint32 circleDomain)
        external;

    /**
     * @notice Disable a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @dev This function is only callable by the contract owner.
     */
    function disableRouterEndpoint(uint16 chain) external;

    /**
     * @notice Updates the `feeRecipient` state variable. This method can
     * only be executed by the owner.
     * @param newFeeRecipient Address of the new `feeRecipient`.
     */
    function updateFeeRecipient(address newFeeRecipient) external;

    /**
     * @notice Sets the allowance of the CCTP token for the token messenger.
     * @param amount The new allowance.
     */
    function setCctpAllowance(uint256 amount) external;
}
