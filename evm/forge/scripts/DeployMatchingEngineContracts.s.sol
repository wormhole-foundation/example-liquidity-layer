// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";
import {MatchingEngineImplementation} from "../../src/MatchingEngine/MatchingEngineImplementation.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

contract DeployMatchingEngineContracts is CheckWormholeContracts, Script {
    uint16 constant _CHAIN_ID = 6;

    address immutable _tokenBridgeAddress = vm.envAddress("RELEASE_TOKEN_BRIDGE_ADDRESS");
    address immutable _wormholeCctpAddress = vm.envAddress("RELEASE_WORMHOLE_CCTP_ADDRESS");
    address immutable _tokenAddress = vm.envAddress("RELEASE_TOKEN_ADDRESS");

    address immutable _ownerAssistantAddress = vm.envAddress("RELEASE_OWNER_ASSISTANT_ADDRESS");

    function deploy() public {
        requireValidChain(_CHAIN_ID, _tokenBridgeAddress, _wormholeCctpAddress);

        MatchingEngineSetup setup = new MatchingEngineSetup();

        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _tokenBridgeAddress,
            _wormholeCctpAddress
        );

        ERC1967Proxy proxy = new ERC1967Proxy(
            address(setup),
            abi.encodeWithSelector(
                bytes4(keccak256("setup(address,address,address,int8)")),
                address(implementation),
                _ownerAssistantAddress,
                address(_tokenAddress),
                int8(0) // CCTP Index.
            )
        );
        console2.log("Deployed MatchingEngine: %s", address(proxy));
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
