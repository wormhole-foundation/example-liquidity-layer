// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

interface IState {
    /**
     * @notice Returns the router address for a given chain ID.
     * @param chain The Wormhole chain ID.
     */
    function getRouter(uint16 chain) external view returns (bytes32);

    /**
     * @notice Returns allow listed token address for this router.
     */
    function orderToken() external view returns (IERC20);

    /**
     * @notice Returns the Wormhole Circle integration contract interface.
     */
    function wormholeCctp() external view returns (ICircleIntegration);

    /**
     * @notice Returns the Wormhole chain ID.
     */
    function wormholeChainId() external view returns (uint16);

    /**
     * @notice Returns true if the `Fill` has been redeemed.
     * @param fillHash The hash of the `Fill` Wormhole message.
     */
    function isFillRedeemed(bytes32 fillHash) external view returns (bool);

    /**
     * @notice Returns the original `deployer` of the contracts.
     * @dev This is not the `owner` of the contracts.
     */
    function getDeployer() external view returns (address);
}
