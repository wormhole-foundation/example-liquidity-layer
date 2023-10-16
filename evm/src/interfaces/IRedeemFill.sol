// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {OrderResponse} from "./Types.sol";

struct RedeemedFill {
    bytes32 sender;
    uint16 senderChain;
    address token;
    uint256 amount;
    bytes message;
}

interface IRedeemFill {
    function redeemFill(OrderResponse memory response) external returns (RedeemedFill memory);
}
