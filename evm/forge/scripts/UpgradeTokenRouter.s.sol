// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {TokenRouterImplementation} from "src/TokenRouter/TokenRouterImplementation.sol";
import {ITokenRouter} from "src/interfaces/ITokenRouter.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

import {Utils} from "src/shared/Utils.sol";

contract UpgradeTokenRouter is CheckWormholeContracts, Script {
    using Utils for address;

    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));
    address immutable _tokenRouterAddress = vm.envAddress("RELEASE_TOKEN_ROUTER_ADDRESS");

    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _wormhole = vm.envAddress("RELEASE_WORMHOLE_ADDRESS");
    address immutable _cctpTokenMessenger = vm.envAddress("RELEASE_TOKEN_MESSENGER_ADDRESS");
    bytes32 immutable _matchingEngineAddress = vm.envBytes32("RELEASE_MATCHING_ENGINE_ADDRESS");
    bytes32 immutable _matchingEngineMintRecipient =
        vm.envBytes32("RELEASE_MATCHING_ENGINE_MINT_RECIPIENT");
    uint16 immutable _matchingEngineChain = uint16(vm.envUint("RELEASE_MATCHING_ENGINE_CHAIN"));
    uint32 immutable _matchingEngineDomain = uint32(vm.envUint("RELEASE_MATCHING_ENGINE_DOMAIN"));

    function upgrade() public {
        requireValidChain(_chainId, _wormhole);

        TokenRouterImplementation implementation = new TokenRouterImplementation(
            _token,
            _wormhole,
            _cctpTokenMessenger,
            _matchingEngineChain,
            _matchingEngineAddress,
            _matchingEngineMintRecipient,
            _matchingEngineDomain
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
