// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

// import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";
// import {MatchingEngineImplementation} from "../../src/MatchingEngine/MatchingEngineImplementation.sol";

contract DeployOrderRouterContracts is Script {
    uint16 immutable _chainId = vm.envUint("RELEASE_CHAIN_ID");

    uint16 immutable _matchingEngineChain = vm.envUint("RELEASE_MATCHING_ENGINE_CHAIN");
    bytes32 immutable _matchingEngineEndpoint = vm.envBytes32("RELEASE_MATCHING_ENGINE_ENDPOINT");

    uint16 immutable _canonicalTokenChain = vm.envUint("RELEASE_CANONICAL_TOKEN_CHAIN");
    bytes32 immutable _canonicalTokenAddress = vm.envBytes32("RELEASE_CANONICAL_TOKEN_ADDRESS");

    address immutable _tokenBridge = vm.envAddress("RELEASE_TOKEN_BRIDGE_ADDRESS");
    address immutable _wormholeCctp = vm.envAddress("RELEASE_WORMHOLE_CCTP_ADDRESS");

    function setUp() public {
        // Check that the expected chain ID for this deployment matches what the contracts know.
        ITokenBridge tokenBridge = ITokenBridge(_tokenBridge);
        require(tokenBridge.chainId() == _chainId, "invalid token bridge chain ID");

        if (_wormholeCctp != address(0)) {
            ICircleIntegration circleIntegration = ICircleIntegration(_wormholeCctp);
            require(circleIntegration.chainId() == _chainId, "invalid wormhole cctp chain ID");
        }
    }

    function deploy() public {
        // MatchingEngineSetup setup = new MatchingEngineSetup();
        // MatchingEngineImplementation implementation = new MatchingEngineImplementation(
        //     _tokenBridge,
        //     _wormholeCctp
        // );
        // ERC1967Proxy proxy = new ERC1967Proxy(
        //     address(setup),
        //     abi.encodeWithSelector(
        //         bytes4(keccak256("setup(address,address,int8)")),
        //         address(implementation),
        //         address(_curvePool),
        //         int8(0)
        //     )
        // );
        // console2.log("Deployed MatchingEngine: %s", address(proxy));
    }

    function run() public {
        // begin sending transactions
        vm.startBroadcast();

        // deploy setup, implementation and erc1967 proxy
        deploy();

        // finished
        vm.stopBroadcast();
    }
}
