// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {OrderResponse, RevertType} from "./Types.sol";

interface IRedeemOrderRevert {
    function redeemOrderRevert(
        OrderResponse memory response
    ) external returns (RevertType, address);
}
