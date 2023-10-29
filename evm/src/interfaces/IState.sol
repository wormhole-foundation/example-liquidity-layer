// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

interface IState {
    function getRouter(uint16 chain) external view returns (bytes32);

    function orderToken() external view returns (IERC20);

    function wormholeCctp() external view returns (ICircleIntegration);

    function wormholeChainId() external view returns (uint16);

    function isFillRedeemed(bytes32 fillHash) external view returns (bool);

    function getDeployer() external view returns (address);
}
