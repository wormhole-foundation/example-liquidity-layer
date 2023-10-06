// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../shared/Admin.sol";
import {Messages} from "../shared/Messages.sol";

import {OrderRouterAdmin} from "./assets/OrderRouterAdmin.sol";
import {PlaceMarketOrder} from "./assets/PlaceMarketOrder.sol";
import {RedeemFill} from "./assets/RedeemFill.sol";
import {RedeemOrderRevert} from "./assets/RedeemOrderRevert.sol";
import {State} from "./assets/State.sol";

import {IOrderRouter} from "../interfaces/IOrderRouter.sol";

contract OrderRouter is
    IOrderRouter,
    OrderRouterAdmin,
    PlaceMarketOrder,
    RedeemFill,
    RedeemOrderRevert
{
    using BytesParsing for bytes;
    using Messages for *;

    constructor(
        address _token,
        uint16 _matchingEngineChain,
        bytes32 _matchingEngineEndpoint,
        uint16 _canonicalTokenChain,
        bytes32 _canonicalTokenAddress,
        address _tokenBridge,
        address _wormholeCircle
    )
        Admin()
        State(
            _token,
            _matchingEngineChain,
            _matchingEngineEndpoint,
            _canonicalTokenChain,
            _canonicalTokenAddress,
            _tokenBridge,
            _wormholeCircle
        )
    {}
}
