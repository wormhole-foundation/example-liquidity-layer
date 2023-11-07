// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {SigningWormholeSimulator} from "wormhole-solidity/WormholeSimulator.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {
    IMockMatchingEngine,
    MockMatchingEngineImplementation
} from "./helpers/mock/MockMatchingEngineImplementation.sol";

import "../../src/MatchingEngine/assets/Errors.sol";
import {MatchingEngineImplementation} from
    "../../src/MatchingEngine/MatchingEngineImplementation.sol";
import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";

import {Messages} from "../../src/shared/Messages.sol";
import {fromUniversalAddress, toUniversalAddress} from "../../src/shared/Utils.sol";

import "../../src/interfaces/IMatchingEngine.sol";
import {FastTransferParameters} from "../../src/interfaces/Types.sol";

contract MatchingEngineTest is Test {
    using Messages for *;

    address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address constant ARBITRUM_USDC_ADDRESS = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;
    address constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
    uint16 constant ARB_CHAIN = 23;
    uint16 constant AVAX_CHAIN = 6;

    // Environment variables.
    uint256 immutable TESTING_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));

    bytes32 immutable CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("AVAX_CIRCLE_BRIDGE"));
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");

    bytes32 immutable FOREIGN_CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("ARB_CIRCLE_BRIDGE"));
    bytes32 immutable FOREIGN_WORMHOLE_CCTP =
        toUniversalAddress(vm.envAddress("ARB_CIRCLE_INTEGRATION"));

    bytes32 immutable TEST_REDEEMER = toUniversalAddress(makeAddr("TEST_REDEEMER"));

    // Fast transfer parameters.
    uint24 immutable FAST_TRANSFER_FEE_IN_BPS = 25000; // 0.25%.
    uint128 immutable FAST_TRANSFER_MAX_AMOUNT = 500000e6; // 500,000 USDC.
    uint128 immutable FAST_TRANSFER_BASE_FEE = 1e6; // 1 USDC.
    uint128 immutable FAST_TRANSFER_INIT_AUCTION_FEE = 1e6; // 1 USDC.

    // Test engines.
    IMatchingEngine engine;
    bytes32 immutable ARB_engine = toUniversalAddress(makeAddr("arbengine"));

    // Matching engine.
    uint16 immutable matchingEngineChain = 2; // Let's pretend the matching engine is on ETH.
    bytes32 immutable matchingEngineAddress = toUniversalAddress(makeAddr("ME"));

    // Integrating contract helpers.
    SigningWormholeSimulator wormholeSimulator;
    CircleSimulator circleSimulator;

    // Convenient interfaces.
    ICircleIntegration wormholeCctp;

    function deployProxy(address _token, address _wormholeCircle)
        internal
        returns (IMatchingEngine)
    {
        // Deploy Implementation.
        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _wormholeCircle,
            _token
        );

        // Deploy Setup.
        MatchingEngineSetup setup = new MatchingEngineSetup();

        address proxy = setup.deployProxy(address(implementation), makeAddr("ownerAssistant"));

        return IMatchingEngine(proxy);
    }

    function setUp() public {
        wormholeCctp = ICircleIntegration(WORMHOLE_CCTP_ADDRESS);

        vm.startPrank(makeAddr("owner"));
        engine = deployProxy(USDC_ADDRESS, address(wormholeCctp));

        vm.stopPrank();

        wormholeSimulator = new SigningWormholeSimulator(
            wormholeCctp.wormhole(),
            TESTING_SIGNER
        );

        circleSimulator = new CircleSimulator(
            TESTING_SIGNER,
            MESSAGE_TRANSMITTER,
            ARBITRUM_USDC_ADDRESS
        );
        circleSimulator.setupCircleAttester();
    }

    /**
     * ADMIN TESTS
     */

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            address(wormholeCctp),
            USDC_ADDRESS 
        );

        // Upgrade the contract.
        vm.prank(makeAddr("owner"));
        engine.upgradeContract(address(newImplementation));

        // Use mock implementation interface.
        IMockMatchingEngine mockEngine = IMockMatchingEngine(address(engine));

        // Verify the new implementation.
        assertEq(mockEngine.getImplementation(), address(newImplementation));
        assertTrue(mockEngine.isUpgraded());
    }

    function testCannotUpgradeContractAgain() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            address(wormholeCctp),
            USDC_ADDRESS 
        );

        vm.startPrank(makeAddr("owner"));

        // Upgrade the contract.
        engine.upgradeContract(address(newImplementation));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized()"));
        engine.upgradeContract(address(newImplementation));
    }

    function testCannotUpgradeContractInvalidAddress() public {
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.upgradeContract(address(0));
    }

    function testCannotUpgradeContractOwnerOnly() public {
        vm.prank(makeAddr("not owner"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        engine.upgradeContract(address(makeAddr("newImplementation")));
    }
}
