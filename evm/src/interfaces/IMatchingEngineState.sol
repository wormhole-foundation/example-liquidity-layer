// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import "./Types.sol";

interface IMatchingEngineState {
    /**
     * @notice Returns the original `deployer` of the contracts.
     * @dev This is not the `owner` of the contracts.
     */
    function getDeployer() external view returns (address);
}
