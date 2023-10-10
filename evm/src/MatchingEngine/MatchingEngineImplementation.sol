// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {MatchingEngineBase} from "./MatchingEngineBase.sol";
import {getImplementationState, Implementation} from "../shared/Admin.sol";

contract MatchingEngineImplementation is MatchingEngineBase {
    constructor(
        address tokenBridge,
        address circleIntegration
    ) MatchingEngineBase(tokenBridge, circleIntegration) {}

    function initialize() public virtual initializer {
        // this function needs to be exposed for an upgrade to pass
    }

    modifier initializer() {
        address impl = ERC1967Upgrade._getImplementation();

        Implementation storage implementation = getImplementationState();

        require(!implementation.isInitialized[impl], "already initialized");

        // Initialize the implementation.
        implementation.isInitialized[impl] = true;

        _;
    }
}
