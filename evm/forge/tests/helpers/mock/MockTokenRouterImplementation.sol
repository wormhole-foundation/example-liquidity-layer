// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {TokenRouter} from "src/TokenRouter/TokenRouter.sol";
import {ITokenRouter} from "src/interfaces/ITokenRouter.sol";

interface IMockTokenRouter is ITokenRouter {
    function isUpgraded() external pure returns (bool);

    function getImplementation() external view returns (address);
}

contract MockTokenRouterImplementation is TokenRouter {
    constructor(
        address _token,
        address _wormhole,
        address _cctpTokenMessenger,
        uint16 _matchingEngineChain,
        bytes32 _matchingEngineAddress,
        bytes32 _matchingEngineMintRecipient,
        uint32 _matchingEngineDomain
    )
        TokenRouter(
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
}
