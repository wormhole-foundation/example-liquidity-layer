// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./Types.sol";
import "./IPlaceMarketOrder.sol";
import "./IRedeemFill.sol";
import "./ITokenRouterState.sol";
import "./ITokenRouterAdmin.sol";
import "./IAdmin.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

interface ITokenRouter is
    IPlaceMarketOrder,
    IRedeemFill,
    ITokenRouterState,
    ITokenRouterAdmin,
    IAdmin
{}
