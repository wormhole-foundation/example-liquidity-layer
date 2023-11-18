// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";

import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";
import {MatchingEngineImplementation} from
    "../../src/MatchingEngine/MatchingEngineImplementation.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

contract UpgradeMatchingEngine is CheckWormholeContracts, Script {
    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));
    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _wormholeCctpAddress = vm.envAddress("RELEASE_WORMHOLE_CCTP_ADDRESS");
    address immutable _matchingEngineAddress = vm.envAddress("RELEASE_MATCHING_ENGINE_ADDRESS");

    function upgrade() public {
        requireValidChain(_chainId, _wormholeCctpAddress);

        console.log("or here?");
        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _token,
            _wormholeCctpAddress
        );
        console.log("here?");
        IMatchingEngine(_matchingEngineAddress).upgradeContract(address(implementation));
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
