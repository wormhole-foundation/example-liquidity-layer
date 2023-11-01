// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../shared/Admin.sol";
import {Messages} from "../shared/Messages.sol";
import {getImplementationState, Implementation} from "../shared/Admin.sol";

import {TokenRouterAdmin} from "./assets/TokenRouterAdmin.sol";
import {PlaceMarketOrder} from "./assets/PlaceMarketOrder.sol";
import {RedeemFill} from "./assets/RedeemFill.sol";
import {State} from "./assets/State.sol";

contract TokenRouterImplementation is
    TokenRouterAdmin,
    PlaceMarketOrder,
    RedeemFill
{
    error AlreadyInitialized();

    constructor(
        address token_,
        address wormholeCircle_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineAddress_
    )
        State(
            token_,
            wormholeCircle_,
            matchingEngineChain_,
            matchingEngineAddress_
        )
    {}

    function initialize() public virtual initializer {
        // this function needs to be exposed for an upgrade to pass
    }

    modifier initializer() {
        address impl = ERC1967Upgrade._getImplementation();

        Implementation storage implementation = getImplementationState();

        if (implementation.isInitialized[impl]) {
            revert AlreadyInitialized();
        }

        // Initialize the implementation.
        implementation.isInitialized[impl] = true;

        _;
    }
}
