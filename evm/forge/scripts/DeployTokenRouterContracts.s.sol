// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {TokenRouterSetup} from "../../src/TokenRouter/TokenRouterSetup.sol";
import {TokenRouterImplementation} from "../../src/TokenRouter/TokenRouterImplementation.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

import {Utils} from "../../src/shared/Utils.sol";

contract DeployTokenRouterContracts is CheckWormholeContracts, Script {
    using Utils for address;

    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));

    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _wormhole = vm.envAddress("RELEASE_WORMHOLE_ADDRESS");
    address immutable _cctpTokenMessenger = vm.envAddress("RELEASE_TOKEN_MESSENGER_ADDRESS");
    address immutable _ownerAssistantAddress = vm.envAddress("RELEASE_OWNER_ASSISTANT_ADDRESS");
    address immutable _matchingEngineAddress = vm.envAddress("RELEASE_MATCHING_ENGINE_ADDRESS");
    uint16 immutable _matchingEngineChain = uint16(vm.envUint("RELEASE_MATCHING_ENGINE_CHAIN"));
    uint32 immutable _matchingEngineDomain = uint32(vm.envUint("RELEASE_MATCHING_ENGINE_DOMAIN"));

    function deploy() public {
        requireValidChain(_chainId, _wormhole);

        TokenRouterImplementation implementation = new TokenRouterImplementation(
            _token,
            _wormhole,
            _cctpTokenMessenger,
            _matchingEngineChain,
            _matchingEngineAddress.toUniversalAddress(),
            _matchingEngineDomain
        );

        TokenRouterSetup setup = new TokenRouterSetup();
        address proxy = setup.deployProxy(address(implementation), _ownerAssistantAddress);

        console2.log("Deployed TokenRouter (chain=%s): %s", _chainId, proxy);
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        // Deploy setup, implementation and erc1967 proxy.
        deploy();

        // Done.
        vm.stopBroadcast();
    }
}
