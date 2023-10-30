// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

interface IAdmin {
    // ------------------------- Admin Only -------------------------

    /**
     * @notice Upgrades the contract to a new implementation.
     * @param newImplementation The address of the new implementation.
     * @dev This function can only be called by the `owner`.
     */
    function upgradeContract(address newImplementation) external;

    /**
     * @notice Sets the `ownerAssistant` to a new address. The `ownerAssistant`
     * is an account that can perform certain administrative functions on behalf
     * of the `owner`.
     * @param newAssistant The address of the new `ownerAssistant`.
     * @dev This function can only be called by the `owner`.
     */
    function updateOwnerAssistant(address newAssistant) external;

    /**
     * @notice Pauses the contract, which disables outbound transfers of USDC.
     * @param paused Whether or not the contract should be paused.
     * @dev This function can only be called by the `owner` or `ownerAssistant`.
     */
    function setPause(bool paused) external;

    /**
     * @notice Submits a request to transfer ownership of the contract to a new
     * address. The request must be confirmed by the new owner before the
     * ownership transfer is complete.
     * @param newOwner The address of the new owner.
     * @dev This function can only be called by the `owner`.
     */
    function submitOwnershipTransferRequest(address newOwner) external;

    /**
     * @notice Cancels a pending ownership transfer request.
     * @dev This function can only be called by the `owner`.
     */
    function cancelOwnershipTransferRequest() external;

    /**
     * @notice Confirms a pending ownership transfer request.
     * @dev This function can only be called by the `pendingOwner`.
     */
    function confirmOwnershipTransferRequest() external;

    // ------------------------- Getters ---------------------------

    /**
     * @notice Returns the address of the current owner.
     */
    function getOwner() external view returns (address);

    /**
     * @notice Returns the address of the current `pendingOwner`.
     */
    function getPendingOwner() external view returns (address);

    /**
     * @notice Returns the address of the current `ownerAssistant`.
     */
    function getOwnerAssistant() external view returns (address);

    /**
     * @notice Returns whether or not the contract is paused.
     */
    function isPaused() external view returns (bool);
}
