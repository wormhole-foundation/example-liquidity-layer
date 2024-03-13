// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {BytesParsing} from "src/shared/WormholeBytesParsing.sol";

import {Admin} from "src/shared/Admin.sol";
import {Messages} from "src/shared/Messages.sol";
import {getImplementationState, Implementation} from "src/shared/Admin.sol";

import {TokenRouterAdmin} from "./assets/TokenRouterAdmin.sol";
import {PlaceMarketOrder} from "./assets/PlaceMarketOrder.sol";
import {RedeemFill} from "./assets/RedeemFill.sol";
import {State} from "./assets/State.sol";

contract TokenRouterImplementation is TokenRouterAdmin, PlaceMarketOrder, RedeemFill {
    error AlreadyInitialized();

    constructor(
        address token_,
        address wormhole_,
        address cctpTokenMessenger_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineAddress_,
        bytes32 matchingEngineMintRecipient_,
        uint32 matchingEngineDomain_
    )
        State(
            token_,
            wormhole_,
            cctpTokenMessenger_,
            matchingEngineChain_,
            matchingEngineAddress_,
            matchingEngineMintRecipient_,
            matchingEngineDomain_
        )
    {}

    function initialize() public virtual initializer {
        // This function needs to be exposed for an upgrade to pass.
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
