// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {MatchingEngineImplementation} from "../../src/MatchingEngine/MatchingEngineImplementation.sol";
import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

contract DeployMatchingEngineContracts is CheckWormholeContracts, Script {
    uint16 constant _CHAIN_ID = 6;

    address immutable _tokenBridgeAddress = vm.envAddress("RELEASE_TOKEN_BRIDGE_ADDRESS");
    address immutable _wormholeCctpAddress = vm.envAddress("RELEASE_WORMHOLE_CCTP_ADDRESS");

    address immutable _matchingEngineAddress = vm.envAddress("RELEASE_MATCHING_ENGINE_ADDRESS");

    function upgrade() public {
        requireValidChain(_CHAIN_ID, _tokenBridgeAddress, _wormholeCctpAddress);

        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _tokenBridgeAddress,
            _wormholeCctpAddress
        );

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
