// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {TokenRouterImplementation} from "../../../../src/TokenRouter/TokenRouterImplementation.sol";
import {ITokenRouter} from "../../../../src/interfaces/ITokenRouter.sol";

interface IMockTokenRouter is ITokenRouter {
    function isUpgraded() external pure returns (bool);

    function getImplementation() external view returns (address);
}

contract MockTokenRouterImplementation is TokenRouterImplementation {
    constructor(
        address _token,
        address _wormholeCircle
    )
        TokenRouterImplementation(
            _token,
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
