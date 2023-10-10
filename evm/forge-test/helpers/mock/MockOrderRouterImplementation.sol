// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {OrderRouterImplementation} from "../../../src/OrderRouter/OrderRouterImplementation.sol";
import {IOrderRouter} from "../../../src/interfaces/IOrderRouter.sol";

interface IMockOrderRouter is IOrderRouter {
    function isUpgraded() external pure returns (bool);

    function getImplementation() external view returns (address);
}

contract MockOrderRouterImplementation is OrderRouterImplementation {
    constructor(
        address _token,
        uint16 _matchingEngineChain,
        bytes32 _matchingEngineEndpoint,
        uint16 _canonicalTokenChain,
        bytes32 _canonicalTokenAddress,
        address _tokenBridge,
        address _wormholeCircle
    )
        OrderRouterImplementation(
            _token,
            _matchingEngineChain,
            _matchingEngineEndpoint,
            _canonicalTokenChain,
            _canonicalTokenAddress,
            _tokenBridge,
            _wormholeCircle
        )
    {}

    function isUpgraded() external pure returns (bool) {
        return true;
    }

    function getImplementation() external view returns (address) {
        return ERC1967Upgrade._getImplementation();
    }
}
