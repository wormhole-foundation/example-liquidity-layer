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
        address _wormhole,
        address _cctpTokenMessenger,
        uint16 _matchingEngineChain,
        bytes32 _matchingEngineAddress,
        bytes32 _matchingEngineMintRecipient,
        uint32 _matchingEngineDomain
    )
        TokenRouterImplementation(
            _token,
            _wormhole,
            _cctpTokenMessenger,
            _matchingEngineChain,
            _matchingEngineAddress,
            _matchingEngineMintRecipient,
            _matchingEngineDomain
        )
    {}

    function isUpgraded() external pure returns (bool) {
        return true;
    }

    function getImplementation() external view returns (address) {
        return ERC1967Upgrade._getImplementation();
    }
}
