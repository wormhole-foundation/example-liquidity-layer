// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {TokenRouterImplementation} from "../../src/TokenRouter/TokenRouterImplementation.sol";
import {ITokenRouter} from "../../src/interfaces/ITokenRouter.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

import {toUniversalAddress} from "../../src/shared/Utils.sol";

contract UpgradeTokenRouter is CheckWormholeContracts, Script {
    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));
    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _wormholeCctpAddress = vm.envAddress("RELEASE_WORMHOLE_CCTP_ADDRESS");
    address immutable _tokenRouterAddress = vm.envAddress("RELEASE_TOKEN_ROUTER_ADDRESS");
    address immutable _matchingEngineAddress = vm.envAddress("RELEASE_MATCHING_ENGINE_ADDRESS");
    uint16 immutable _matchingEngineChain = uint16(vm.envUint("RELEASE_MATCHING_ENGINE_CHAIN"));

    function upgrade() public {
        requireValidChain(_chainId, _wormholeCctpAddress);

        TokenRouterImplementation implementation = new TokenRouterImplementation(
            _token,
            _wormholeCctpAddress,
            _matchingEngineChain,
            toUniversalAddress(_matchingEngineAddress)
        );

        ITokenRouter(_tokenRouterAddress).upgradeContract(address(implementation));
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        // Perform upgrade.
        upgrade();

        // Done.
        vm.stopBroadcast();
    }
}
