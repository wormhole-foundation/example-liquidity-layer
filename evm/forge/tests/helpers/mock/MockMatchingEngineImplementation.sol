// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {MatchingEngineImplementation} from "../../../../src/MatchingEngine/MatchingEngineImplementation.sol";
import {IMatchingEngine} from "../../../../src/interfaces/IMatchingEngine.sol";

interface IMockMatchingEngine is IMatchingEngine {
    function isUpgraded() external pure returns (bool);

    function getImplementation() external view returns (address);
}

contract MockMatchingEngineImplementation is MatchingEngineImplementation {
    constructor(
        address tokenBridge,
        address circleIntegration
    ) MatchingEngineImplementation(tokenBridge, circleIntegration) {}

    function isUpgraded() external pure returns (bool) {
        return true;
    }

    function getImplementation() external view returns (address) {
        return ERC1967Upgrade._getImplementation();
    }
}
