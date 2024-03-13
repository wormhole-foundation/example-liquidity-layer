// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./IMatchingEngineState.sol";
import "./IMatchingEngineAdmin.sol";
import "./IMatchingEngineFastOrders.sol";
import "./IAdmin.sol";
import "src/shared/Messages.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMatchingEngine is
    IMatchingEngineFastOrders,
    IMatchingEngineState,
    IMatchingEngineAdmin,
    IAdmin
{}
