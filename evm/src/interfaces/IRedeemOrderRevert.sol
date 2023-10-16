// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {OrderResponse} from "./Types.sol";
import {Messages} from "../shared/Messages.sol";

interface IRedeemOrderRevert {
    function redeemOrderRevert(
        OrderResponse memory response
    ) external returns (Messages.RevertType);
}
