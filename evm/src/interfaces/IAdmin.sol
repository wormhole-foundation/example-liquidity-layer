// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

interface IAdmin {
    function upgradeContract(address newImplementation) external;

    function getOwner() external view returns (address);

    function getPendingOwner() external view returns (address);

    function getOwnerAssistant() external view returns (address);

    function isPaused() external view returns (bool);

    function setPause(bool paused) external;

    function submitOwnershipTransferRequest(address newOwner) external;

    function cancelOwnershipTransferRequest() external;

    function confirmOwnershipTransferRequest() external;

    function updateOwnerAssistant(address newAssistant) external;
}
