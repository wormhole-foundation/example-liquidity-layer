// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../shared/Admin.sol";
import {Messages} from "../shared/Messages.sol";
import {getImplementationState, Implementation} from "../shared/Admin.sol";

import {MatchingEngineAdmin} from "./assets/MatchingEngineAdmin.sol";
import {State} from "./assets/State.sol";

contract MatchingEngineImplementation is
    MatchingEngineAdmin
{
    error AlreadyInitialized();

    constructor()
        State()
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
