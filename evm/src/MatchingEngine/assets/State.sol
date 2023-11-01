// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";

import "./Errors.sol";

abstract contract State {
    // Immutable state.
    address immutable _deployer;

    constructor() {
        _deployer = msg.sender;
    }
}