// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {OrderRouterBase} from "./OrderRouterBase.sol";
import {getImplementationState, Implementation} from "../shared/Admin.sol";

contract OrderRouterImplementation is OrderRouterBase {
    constructor(
        address _token,
        uint16 _matchingEngineChain,
        bytes32 _matchingEngineEndpoint,
        uint16 _canonicalTokenChain,
        bytes32 _canonicalTokenAddress,
        address _tokenBridge,
        address _wormholeCircle
    )
        OrderRouterBase(
            _token,
            _matchingEngineChain,
            _matchingEngineEndpoint,
            _canonicalTokenChain,
            _canonicalTokenAddress,
            _tokenBridge,
            _wormholeCircle
        )
    {}

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

    function orderRouterImplementation() public pure returns (bytes32) {
        return keccak256("orderRouterImplementation()");
    }
}
