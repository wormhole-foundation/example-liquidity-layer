// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

interface IMatchingEngineAdmin {
    /**
     * @notice Add a `router` endpoint for the specified Wormhole `chain`.
     * @param chain The Wormhole chain ID.
     * @param router The `router` address in Wormhole universal format.
     * @dev This function is only callable by the contract owner or assistant.
     */
    function addRouterEndpoint(uint16 chain, bytes32 router) external;
}
