// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/StdUtils.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";

import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";
import {MatchingEngineImplementation} from "../../src/MatchingEngine/MatchingEngineImplementation.sol";
import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";
import {Messages} from "../../src/shared/Messages.sol";
import {toUniversalAddress, fromUniversalAddress} from "../../src/shared/Utils.sol";

import {IMockMatchingEngine, MockMatchingEngineImplementation} from "./helpers/mock/MockMatchingEngineImplementation.sol";

import {TestHelpers} from "./helpers/MatchingEngineTestHelpers.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {WormholePoolTestHelper} from "curve-solidity/WormholeCurvePool.sol";
import {SigningWormholeSimulator} from "modules/wormhole/WormholeSimulator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MatchingEngineTest is TestHelpers, WormholePoolTestHelper {
    // Env variables.
    address immutable TOKEN_BRIDGE = vm.envAddress("AVAX_TOKEN_BRIDGE_ADDRESS");
    address immutable CIRCLE_INTEGRATION = vm.envAddress("AVAX_WORMHOLE_CCTP_ADDRESS");
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");
    uint256 immutable GUARDIAN_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));
    bytes32 immutable SUI_BRIDGE = vm.envBytes32("SUI_TOKEN_BRIDGE_ADDRESS");
    bytes32 immutable ARB_BRIDGE = toUniversalAddress(vm.envAddress("ARB_TOKEN_BRIDGE_ADDRESS"));
    bytes32 immutable POLY_BRIDGE = toUniversalAddress(vm.envAddress("POLY_TOKEN_BRIDGE_ADDRESS"));

    // USDC info.
    address constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address constant WRAPPED_ETH_USDC = 0xB24CA28D4e2742907115fECda335b40dbda07a4C;
    address constant WRAPPED_SOL_USDC = 0x0950Fc1AD509358dAeaD5eB8020a3c7d8b43b9DA;
    address constant WRAPPED_POLY_USDC = 0x543672E9CBEC728CBBa9C3Ccd99ed80aC3607FA8;
    address constant NATIVE_ETH_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant NATIVE_POLY_USDC = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant NATIVE_ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    // Test Variables.
    address immutable TEST_SENDER = makeAddr("testSender");
    address immutable TEST_REDEEMER = makeAddr("testRedeemer");
    address immutable TEST_RECIPIENT = makeAddr("testRecipient");
    bytes32 immutable SUI_ROUTER = toUniversalAddress(makeAddr("suiRouter"));
    bytes32 immutable ARB_ROUTER = toUniversalAddress(makeAddr("arbRouter"));
    bytes32 immutable POLY_ROUTER = toUniversalAddress(makeAddr("polyRouter"));
    bytes32 immutable AVAX_ROUTER = toUniversalAddress(makeAddr("avaxRouter"));
    uint256 immutable INIT_LIQUIDITY = 2_000_000 * 10 ** 6; // 2 x CCTP Burn Limit
    uint16 constant SUI_CHAIN = 21;
    uint16 constant ETH_CHAIN = 2;
    uint16 constant ARB_CHAIN = 23;
    uint16 constant POLY_CHAIN = 5;
    uint16 constant AVAX_CHAIN = 6;
    uint256 constant RELAYER_FEE = 5_000_000; // (5 USDC)
    uint256 constant WORMHOLE_FEE = 1e16;
    uint8 constant MAX_RELAYER_COUNT = 8;

    IMatchingEngine engine;
    SigningWormholeSimulator wormholeSimulator;
    CircleSimulator circleSimulator;
    address[4] poolCoins;
    mapping(address => int128) public curvePoolIndex;

    /// @notice We use a constructor here so that the curve pool is only deployed once
    // (vs. in a `setUp` function).
    constructor()
        WormholePoolTestHelper([USDC, WRAPPED_ETH_USDC, WRAPPED_SOL_USDC, WRAPPED_POLY_USDC])
    {
        poolCoins = [USDC, WRAPPED_ETH_USDC, WRAPPED_SOL_USDC, WRAPPED_POLY_USDC];
        curvePoolIndex[USDC] = 0;
        curvePoolIndex[WRAPPED_ETH_USDC] = 1;
        curvePoolIndex[WRAPPED_SOL_USDC] = 2;
        curvePoolIndex[WRAPPED_POLY_USDC] = 3;
    }

    function _mintAndProvideLiquidity(uint256 amount) internal returns (uint256) {
        // Mint tokens and approve them for the curve pool.
        uint256[4] memory amounts;
        for (uint256 i = 0; i < poolCoins.length; ++i) {
            deal(poolCoins[i], address(this), amount);
            IERC20(poolCoins[i]).approve(curvePool, amount);
            amounts[i] = amount;
        }

        return
            addCurveLiquidity(
                amounts,
                0 // minimum LP shares
            );
    }

    function _removeLiquidityAndBurn(uint256 amount) internal {
        // Remove liquidity and burn the USDC.
        uint256 minAmount = 0;
        uint256[4] memory minAmounts = [minAmount, minAmount, minAmount, minAmount];
        removeCurveLiquidity(amount, minAmounts);

        for (uint256 i = 0; i < poolCoins.length; ++i) {
            deal(poolCoins[i], address(this), 0);
        }
    }

    function _deployAndSetupMatchingEngine() internal {
        // Deploy Setup.
        MatchingEngineSetup setup = new MatchingEngineSetup();

        // Deploy Implementation.
        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            TOKEN_BRIDGE,
            CIRCLE_INTEGRATION
        );

        // Deploy Proxy.
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(setup),
            abi.encodeWithSelector(
                bytes4(keccak256("setup(address,address,address,int8)")),
                address(implementation),
                makeAddr("ownerAssistant"),
                address(curvePool),
                int8(0)
            )
        );
        engine = IMatchingEngine(address(proxy));

        // Set the initial router.
        engine.registerOrderRouter(SUI_CHAIN, SUI_ROUTER);
        engine.registerOrderRouter(ARB_CHAIN, ARB_ROUTER);
        engine.registerOrderRouter(POLY_CHAIN, POLY_ROUTER);
        engine.registerOrderRouter(AVAX_CHAIN, AVAX_ROUTER);

        // Set the initial routes.
        engine.enableExecutionRoute(ARB_CHAIN, USDC, true, int8(curvePoolIndex[USDC]));
        engine.enableExecutionRoute(
            SUI_CHAIN,
            WRAPPED_ETH_USDC,
            false,
            int8(curvePoolIndex[WRAPPED_ETH_USDC])
        );
        engine.enableExecutionRoute(
            POLY_CHAIN,
            WRAPPED_POLY_USDC,
            false,
            int8(curvePoolIndex[WRAPPED_POLY_USDC])
        );
        engine.enableExecutionRoute(AVAX_CHAIN, USDC, true, int8(curvePoolIndex[USDC]));
    }

    function _setupWormholeSimulator() internal {
        wormholeSimulator = new SigningWormholeSimulator(engine.wormhole(), GUARDIAN_SIGNER);
        wormholeSimulator.setMessageFee(WORMHOLE_FEE);
    }

    function _setupCircleSimulator() internal {
        circleSimulator = new CircleSimulator(
            GUARDIAN_SIGNER,
            MESSAGE_TRANSMITTER,
            NATIVE_ARB_USDC
        );
        circleSimulator.setupCircleAttester();
    }

    function setUp() public {
        _deployAndSetupMatchingEngine();
        _setupWormholeSimulator();
        _setupCircleSimulator();
        _initializeTestHelper(
            wormholeSimulator,
            circleSimulator,
            TOKEN_BRIDGE,
            CIRCLE_INTEGRATION,
            poolCoins,
            address(engine),
            AVAX_CHAIN,
            TEST_SENDER,
            TEST_REDEEMER,
            TEST_RECIPIENT
        );
    }

    /**
     * Admin Tests
     */

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            TOKEN_BRIDGE,
            CIRCLE_INTEGRATION
        );

        // Upgrade the contract.
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
            TOKEN_BRIDGE,
            CIRCLE_INTEGRATION
        );

        // Upgrade the contract.
        engine.upgradeContract(address(newImplementation));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized()"));
        engine.upgradeContract(address(newImplementation));
    }

    function testCannotUpgradeContractInvalidAddress() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.upgradeContract(address(0));
    }

    function testCannotUpgradeContractOwnerOnly() public {
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        engine.upgradeContract(address(makeAddr("newImplementation")));
    }

    function testEnableExecutionRoute() public {
        uint16 chainId = 69;
        address target = makeAddr("ethEmitter");
        bool cctp = true;
        int8 poolIndex = 0; // CCTP USDC index.

        {
            IMatchingEngine.Route memory route = engine.getExecutionRoute(chainId);
            assertEq(route.target, address(0));
            assertEq(route.cctp, false);
            assertEq(route.poolIndex, 0);
        }

        // Set the initial route.
        {
            engine.enableExecutionRoute(chainId, target, cctp, poolIndex);

            IMatchingEngine.Route memory route = engine.getExecutionRoute(chainId);
            assertEq(route.target, target);
            assertEq(route.cctp, cctp);
            assertEq(route.poolIndex, poolIndex);
        }

        // Update the route to make sure the owner can change it.
        {
            target = makeAddr("solEmitter");
            cctp = false;
            poolIndex = 2;

            engine.enableExecutionRoute(chainId, target, cctp, poolIndex);

            IMatchingEngine.Route memory route = engine.getExecutionRoute(chainId);
            assertEq(route.target, target);
            assertEq(route.cctp, cctp);
            assertEq(route.poolIndex, poolIndex);
        }
    }

    function testCannotEnableExecutionRouteInvalidAddress() public {
        uint16 chainId = 69;
        address target = address(0);
        bool cctp = false;
        int8 poolIndex = 1;

        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.enableExecutionRoute(chainId, target, cctp, poolIndex);
    }

    function testCannotEnableExecutionRouteInvalidTokenIndex() public {
        uint16 chainId = 69;
        address target = makeAddr("token");
        bool cctp = true;
        int8 poolIndex = 69; // Must be CCTP USDC index.

        vm.expectRevert(abi.encodeWithSignature("InvalidTokenIndex()"));
        engine.enableExecutionRoute(chainId, target, cctp, poolIndex);
    }

    function testCannotEnableExecutionRouteOwnerOrAssistantOnly() public {
        uint16 chainId = 69;
        address target = makeAddr("token");
        bool cctp = false;
        int8 poolIndex = 1;

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.enableExecutionRoute(chainId, target, cctp, poolIndex);
    }

    function testDisableExecutionRoute() public {
        uint16 chainId = 69;
        address target = makeAddr("token");
        bool cctp = false;
        int8 poolIndex = 1;

        // Set the initial route.
        engine.enableExecutionRoute(chainId, target, cctp, poolIndex);

        // Disable the route.
        engine.disableExecutionRoute(chainId);

        IMatchingEngine.Route memory route = engine.getExecutionRoute(chainId);
        assertEq(route.target, address(0));
        assertEq(route.cctp, false);
        assertEq(route.poolIndex, 0);
    }

    function testCannotDisableExecutionRouteOnlyOrOrAssistant() public {
        uint16 chainId = 69;

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.disableExecutionRoute(chainId);
    }

    function testRegisterOrderRouter() public {
        uint16 chainId = 69;
        bytes32 router = toUniversalAddress(makeAddr("orderRouter"));

        {
            bytes32 registered = engine.getOrderRouter(chainId);
            assertEq(registered, bytes32(0));
        }

        // Set the initial router.
        {
            engine.registerOrderRouter(chainId, router);

            bytes32 registered = engine.getOrderRouter(chainId);
            assertEq(registered, router);
        }

        // Update the router to make sure the owner can change it.
        {
            router = toUniversalAddress(makeAddr("orderRouter2"));

            engine.registerOrderRouter(chainId, router);

            bytes32 registered = engine.getOrderRouter(chainId);
            assertEq(registered, router);
        }
    }

    function testCannotRegisterOrderRouterInvalidAddress() public {
        uint16 chainId = 69;
        bytes32 router = bytes32(uint256(0));

        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.registerOrderRouter(chainId, router);
    }

    function testCannotRegisterOrderRouterInvalidChainId() public {
        uint16 chainId = 0;
        bytes32 router = bytes32(uint256(420));

        vm.expectRevert(abi.encodeWithSignature("InvalidChainId()"));
        engine.registerOrderRouter(chainId, router);
    }

    function testCannotRegisterOrderRouterOnlyOwnerOrAssistant() public {
        uint16 chainId = 69;
        bytes32 router = bytes32(uint256(420));

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.registerOrderRouter(chainId, router);
    }

    function testUpdateCurvePool() public {
        // Check initial curve pool info.
        {
            IMatchingEngine.CurvePoolInfo memory info = engine.getCurvePoolInfo();
            assertEq(address(info.pool), curvePool);
            assertEq(info.nativeTokenIndex, 0);
        }

        // Update the curve pool.
        {
            ICurvePool newCurvePool = ICurvePool(makeAddr("newCurvePool"));
            int8 newNativeTokenIndex = 1;

            engine.updateCurvePool(newCurvePool, newNativeTokenIndex);

            IMatchingEngine.CurvePoolInfo memory info = engine.getCurvePoolInfo();
            assertEq(address(info.pool), address(newCurvePool));
            assertEq(info.nativeTokenIndex, newNativeTokenIndex);
        }
    }

    function testCannotUpdateCurvePoolInvalidAddress() public {
        ICurvePool newCurvePool = ICurvePool(address(0));
        int8 newNativeTokenIndex = 1;

        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.updateCurvePool(newCurvePool, newNativeTokenIndex);
    }

    function testCannotUpdateCurvePoolOnlyOwnerOrAssistant() public {
        ICurvePool newCurvePool = ICurvePool(makeAddr("newCurvePool"));
        int8 newNativeTokenIndex = 1;

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.updateCurvePool(newCurvePool, newNativeTokenIndex);
    }

    function testSetPause() public {
        // Check initial pause state.
        {
            bool paused = engine.isPaused();
            assertEq(paused, false);
        }

        // Pause the contract.
        {
            engine.setPause(true);

            bool paused = engine.isPaused();
            assertEq(paused, true);
        }

        // Unpause the contract.
        {
            engine.setPause(false);

            bool paused = engine.isPaused();
            assertEq(paused, false);
        }
    }

    function testSubmitOwnershipTransferRequest() public {
        address newOwner = makeAddr("newOwner");

        // Check initial ownership state.
        {
            address owner = engine.owner();
            assertEq(owner, address(this));

            address pendingOwner = engine.pendingOwner();
            assertEq(pendingOwner, address(0));
        }

        // Submit the ownership transfer request.
        {
            engine.submitOwnershipTransferRequest(newOwner);

            address pendingOwner = engine.pendingOwner();
            assertEq(pendingOwner, newOwner);
        }
    }

    function testCannotSubmitOwnershipTransferRequestInvalidAddress() public {
        address newOwner = address(0);

        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.submitOwnershipTransferRequest(newOwner);
    }

    function testCannotSubmitOwnershipTransferRequestOwnerOnly() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        engine.submitOwnershipTransferRequest(newOwner);
    }

    function testCancelOwnershipTransferRequest() public {
        address newOwner = makeAddr("newOwner");

        // Submit the ownership transfer request.
        engine.submitOwnershipTransferRequest(newOwner);

        // Cancel the ownership transfer request.
        engine.cancelOwnershipTransferRequest();

        address pendingOwner = engine.pendingOwner();
        assertEq(pendingOwner, address(0));
    }

    function testCannotCancelOwnershipTransferRequestOwnerOnly() public {
        address newOwner = makeAddr("newOwner");

        // Submit the ownership transfer request.
        engine.submitOwnershipTransferRequest(newOwner);

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        engine.cancelOwnershipTransferRequest();
    }

    function testConfirmOwnershipTransferRequest() public {
        address newOwner = makeAddr("newOwner");

        // Verify current owner.
        assertEq(engine.owner(), address(this));

        // Submit the ownership transfer request.
        engine.submitOwnershipTransferRequest(newOwner);

        // Confirm by pranking with the newOwner address.
        vm.prank(newOwner);
        engine.confirmOwnershipTransferRequest();

        assertEq(engine.owner(), newOwner);
        assertEq(engine.pendingOwner(), address(0));
    }

    function testCannotConfirmOwnershipTransferRequestNotPendingOwner() public {
        address newOwner = makeAddr("newOwner");

        // Submit the ownership transfer request.
        engine.submitOwnershipTransferRequest(newOwner);

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotPendingOwner()"));
        engine.confirmOwnershipTransferRequest();
    }

    /**
     * Business Logic Tests
     */

    function testExecuteOrderFromCanonicalToCCTP(
        uint256 amount,
        bytes memory redeemerMessage
    ) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = WRAPPED_ETH_USDC;

        // Fuzz parameter.
        amount = bound(amount, RELAYER_FEE + 10, INIT_LIQUIDITY / 2);
        vm.assume(redeemerMessage.length < type(uint32).max);

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(
            curvePoolIndex[fromUsdc],
            engine.getCCTPIndex(),
            amount - RELAYER_FEE
        );
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Sui to Arbitrum.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(address(this));

        // Execute the order.
        vm.recordLogs();
        vm.deal(address(this), WORMHOLE_FEE);
        engine.executeOrder{value: WORMHOLE_FEE}(signedOrder);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the circle integration contract.
        _assertCCTPMessage(
            _vm,
            amountOut,
            toUniversalAddress(USDC), // CCTP USDC
            ARB_ROUTER,
            ARB_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadCCTP(_vm, SUI_CHAIN, redeemerMessage);
        assertEq(IERC20(fromUsdc).balanceOf(address(this)) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderFromCanonicalToNative(
        uint256 amount,
        bytes memory redeemerMessage
    ) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = WRAPPED_ETH_USDC;
        address toUsdc = WRAPPED_POLY_USDC;

        // Fuzz parameter.
        amount = bound(amount, RELAYER_FEE + 10, INIT_LIQUIDITY / 2);
        vm.assume(redeemerMessage.length < type(uint32).max);

        // Mint tokens in case total supply on the bridge is less
        // than the test amount.
        _increaseWrappedSupply(toUsdc, amount);

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(
            curvePoolIndex[fromUsdc],
            curvePoolIndex[toUsdc],
            amount - RELAYER_FEE
        );
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Sui to Polygon.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                POLY_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(address(this));

        // Execute the order.
        vm.recordLogs();
        vm.deal(address(this), WORMHOLE_FEE);
        engine.executeOrder{value: WORMHOLE_FEE}(signedOrder);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the token bridge.
        _assertTokenBridgeMessage(
            _vm,
            amountOut,
            toUniversalAddress(NATIVE_POLY_USDC),
            POLY_CHAIN,
            POLY_ROUTER,
            POLY_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadTokenBridge(_vm, SUI_CHAIN, redeemerMessage);
        assertEq(IERC20(fromUsdc).balanceOf(address(this)) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderFromCCTPToCanonical(
        uint256 amount,
        bytes memory redeemerMessage
    ) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = USDC;
        address toUsdc = WRAPPED_ETH_USDC;

        // Fuzz parameter.
        amount = bound(amount, RELAYER_FEE + 10, INIT_LIQUIDITY / 2);
        vm.assume(redeemerMessage.length < type(uint32).max);

        // Mint tokens in case total supply on the bridge is less
        // than the test amount.
        _increaseWrappedSupply(toUsdc, amount);

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(
            engine.getCCTPIndex(),
            curvePoolIndex[toUsdc],
            amount - RELAYER_FEE
        );
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Arb to Sui.
        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                SUI_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(address(this));

        // Execute the order.
        vm.recordLogs();
        vm.deal(address(this), WORMHOLE_FEE);
        engine.executeOrder{value: WORMHOLE_FEE}(params);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the token bridge.
        _assertTokenBridgeMessage(
            _vm,
            amountOut,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadTokenBridge(_vm, ARB_CHAIN, redeemerMessage);
        assertEq(IERC20(fromUsdc).balanceOf(address(this)) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderFromOrderRouter(uint256 amount, bytes memory redeemerMessage) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = USDC;
        address toUsdc = WRAPPED_ETH_USDC;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        // Fuzz parameter.
        amount = bound(amount, 10, INIT_LIQUIDITY / 2);
        vm.assume(redeemerMessage.length < type(uint32).max);

        // Mint tokens in case total supply on the bridge is less
        // than the test amount.
        _increaseWrappedSupply(toUsdc, amount);

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(engine.getCCTPIndex(), curvePoolIndex[toUsdc], amount);
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Avax to Sui.
        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(address(this));

        // Execute the order.
        vm.recordLogs();
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        vm.startPrank(fromRouter);
        SafeERC20.safeIncreaseAllowance(IERC20(USDC), address(engine), amount);
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
        vm.stopPrank();

        // // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the token bridge.
        _assertTokenBridgeMessage(
            _vm,
            amountOut,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadTokenBridge(_vm, AVAX_CHAIN, redeemerMessage);

        // No relayer fee should be paid.
        assertEq(IERC20(fromUsdc).balanceOf(address(this)) - relayerBalanceBefore, 0);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderRevertFromCCTP(uint256 amount, bytes memory redeemerMessage) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = USDC;

        // Fuzz parameter.
        amount = bound(amount, RELAYER_FEE + 10, INIT_LIQUIDITY / 2);
        vm.assume(redeemerMessage.length < type(uint32).max);

        // Set the `minAmountOut` to the same value as `amount'. This will cause
        // the swap to fail, since it assumes zero slippage.
        uint256 amountOut = amount - RELAYER_FEE;

        // Create a valid transfer from Sui to Polygon.
        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                SUI_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(address(this));

        // Execute the order.
        vm.recordLogs();
        vm.deal(address(this), WORMHOLE_FEE);
        engine.executeOrder{value: WORMHOLE_FEE}(params);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The OrderRevert should be sent via CCTP.
        _assertCCTPMessage(
            _vm,
            amountOut,
            toUniversalAddress(USDC), // CCTP USDC
            ARB_ROUTER,
            ARB_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertOrderRevertPayloadCCTP(
            _vm,
            uint8(IMatchingEngine.RevertType.SwapFailed),
            toUniversalAddress(TEST_RECIPIENT)
        );
        assertEq(IERC20(fromUsdc).balanceOf(address(this)) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderRevertFromNative(uint256 amount, bytes memory redeemerMessage) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = WRAPPED_POLY_USDC;

        // Fuzz parameter.
        amount = bound(amount, RELAYER_FEE + 10, INIT_LIQUIDITY / 2);
        vm.assume(redeemerMessage.length < type(uint32).max);

        // Set the `minAmountOut` to the same value as `amount'. This will cause
        // the swap to fail, since it assumes zero slippage.
        uint256 amountOut = amount - RELAYER_FEE;

        // Create a valid transfer from Polygon to Sui.
        bytes memory signedMessage = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_POLY_USDC),
            POLY_CHAIN,
            POLY_ROUTER,
            POLY_BRIDGE,
            POLY_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                SUI_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(address(this));

        // Execute the order.
        vm.recordLogs();
        vm.deal(address(this), WORMHOLE_FEE);
        engine.executeOrder{value: WORMHOLE_FEE}(signedMessage);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The OrderRevert should be sent via CCTP.
        _assertTokenBridgeMessage(
            _vm,
            amountOut,
            toUniversalAddress(NATIVE_POLY_USDC),
            POLY_CHAIN,
            POLY_ROUTER,
            POLY_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertOrderRevertPayloadTokenBridge(
            _vm,
            uint8(IMatchingEngine.RevertType.SwapFailed),
            toUniversalAddress(TEST_RECIPIENT)
        );
        assertEq(IERC20(fromUsdc).balanceOf(address(this)) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderWithAllowedRelayers(uint8 relayerCount, uint256 callerIndex) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = WRAPPED_ETH_USDC;
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";

        // Create an array of allowed relayers.
        relayerCount = uint8(bound(relayerCount, 1, MAX_RELAYER_COUNT));
        callerIndex = bound(callerIndex, 0, relayerCount - 1);
        bytes32[] memory allowedRelayers = _createAllowedRelayerArray(relayerCount);

        // Selected relayer.
        address relayer = fromUniversalAddress(allowedRelayers[callerIndex]);

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(
            curvePoolIndex[fromUsdc],
            engine.getCCTPIndex(),
            amount - RELAYER_FEE
        );
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Sui to Arbitrum.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                allowedRelayers
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(relayer);

        // Execute the order.
        vm.recordLogs();
        vm.deal(relayer, WORMHOLE_FEE);
        vm.prank(relayer);
        engine.executeOrder{value: WORMHOLE_FEE}(signedOrder);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the circle integration contract.
        _assertCCTPMessage(
            _vm,
            amountOut,
            toUniversalAddress(USDC), // CCTP USDC
            ARB_ROUTER,
            ARB_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadCCTP(_vm, SUI_CHAIN, redeemerMessage);
        assertEq(IERC20(fromUsdc).balanceOf(relayer) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderWithNoRelayerFee(uint8 relayerCount, uint256 callerIndex) public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = WRAPPED_ETH_USDC;
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";

        // Create an array of allowed relayers.
        relayerCount = uint8(bound(relayerCount, 1, MAX_RELAYER_COUNT));
        callerIndex = bound(callerIndex, 0, relayerCount - 1);
        bytes32[] memory allowedRelayers = _createAllowedRelayerArray(relayerCount);

        // Selected relayer, this relayer is not included in the allowedRelayers list. However,
        // it should be allowed to relay the message since the fee is set to zero.
        address relayer = address(this);
        uint256 relayerFee = 0;

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(curvePoolIndex[fromUsdc], engine.getCCTPIndex(), amount);
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Sui to Arbitrum.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                relayerFee,
                allowedRelayers
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(relayer);

        // Execute the order.
        vm.recordLogs();
        vm.deal(relayer, WORMHOLE_FEE);
        vm.prank(relayer);
        engine.executeOrder{value: WORMHOLE_FEE}(signedOrder);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the circle integration contract.
        _assertCCTPMessage(
            _vm,
            amountOut,
            toUniversalAddress(USDC), // CCTP USDC
            ARB_ROUTER,
            ARB_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadCCTP(_vm, SUI_CHAIN, redeemerMessage);
        assertEq(IERC20(fromUsdc).balanceOf(relayer) - relayerBalanceBefore, relayerFee);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testExecuteOrderAllowedRelayerTimeoutExpired() public {
        // Before test.
        uint256 lpShares = _mintAndProvideLiquidity(INIT_LIQUIDITY);
        address fromUsdc = WRAPPED_ETH_USDC;
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";

        // Create an array of allowed relayers.
        bytes32[] memory allowedRelayers = _createAllowedRelayerArray(5);

        // We will use a relayer that is not in the allowedRelayers array.
        address actualRelayer = address(this);

        // We will use this amountOut as the minAmountOut for the order,
        // since there is no competing order flow in this test.
        uint256 amountOut = get_amount_out(
            curvePoolIndex[fromUsdc],
            engine.getCCTPIndex(),
            amount - RELAYER_FEE
        );
        require(amountOut > 0, "invalid test");

        // Create a valid transfer from Sui to Arbitrum.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                allowedRelayers
            )
        );

        // Relayer balance before.
        uint256 relayerBalanceBefore = IERC20(fromUsdc).balanceOf(actualRelayer);

        // Warp time so that the relay timeout has expired. This will allow the actual relayer
        // to relay the message.
        vm.warp(block.timestamp + engine.RELAY_TIMEOUT() + 1);

        // Execute the order.
        vm.recordLogs();
        vm.deal(actualRelayer, WORMHOLE_FEE);
        vm.prank(actualRelayer);
        engine.executeOrder{value: WORMHOLE_FEE}(signedOrder);

        // Fetch wormhole message and sign it.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        IWormhole.VM memory _vm = wormholeSimulator.parseVMFromLogs(entries[entries.length - 1]);

        // Validate test results. The fill should be sent via the circle integration contract.
        _assertCCTPMessage(
            _vm,
            amountOut,
            toUniversalAddress(USDC), // CCTP USDC
            ARB_ROUTER,
            ARB_CHAIN,
            toUniversalAddress(address(engine))
        );
        _assertFillPayloadCCTP(_vm, SUI_CHAIN, redeemerMessage);
        assertEq(IERC20(fromUsdc).balanceOf(actualRelayer) - relayerBalanceBefore, RELAYER_FEE);

        // After test.
        _removeLiquidityAndBurn(lpShares);
    }

    function testCannotExecuteOrderInvalidRouteTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Disable the target route.
        engine.disableExecutionRoute(ARB_CHAIN);

        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("InvalidRoute()"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderRouteMismatchTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Disable the target route.
        engine.enableExecutionRoute(SUI_CHAIN, makeAddr("badAddress"), false, 69);

        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("RouteMismatch()"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderNotAllowedRelayerTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Create list of allowed relayers.
        bytes32[] memory allowedRelayers = _createAllowedRelayerArray(5);

        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                allowedRelayers
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("NotAllowedRelayer()"));
        vm.prank(makeAddr("notAllowedRelayer"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderUnregisteredOrderRouterTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Change the registered emitter address for the Sui chain.
        engine.registerOrderRouter(SUI_CHAIN, toUniversalAddress(makeAddr("badAddress")));

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("UnregisteredOrderRouter()"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderUnregisteredOrderRouterNoTargetTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Send to an unregistered chain ID.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut,
                69, // Unregistered chain ID.
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("UnregisteredOrderRouter()"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderIsPausedTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Send to an unregistered chain ID.
        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut,
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Pause the engine.
        engine.setPause(true);

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("ContractPaused()"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderInvalidCCTPIndexTokenBridge() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Change the CCTP token index.
        engine.updateCurvePool(ICurvePool(curvePool), 69);

        bytes memory signedOrder = _craftValidTokenBridgeMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ETH_USDC),
            ETH_CHAIN,
            SUI_ROUTER,
            SUI_BRIDGE,
            SUI_CHAIN,
            _encodeTestMarketOrder(
                amountOut,
                ARB_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("InvalidCCTPIndex()"));
        engine.executeOrder(signedOrder);
    }

    function testCannotExecuteOrderInvalidRouteCCTP() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Disable the target route.
        engine.disableExecutionRoute(POLY_CHAIN);

        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                POLY_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("InvalidRoute()"));
        engine.executeOrder(params);
    }

    function testCannotExecuteOrderRouteNotAvailableCCTP() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Enable new CCTP route with invalid chainID.
        engine.enableExecutionRoute(
            POLY_CHAIN,
            WRAPPED_POLY_USDC,
            true, // Set CCTP to true.
            int8(curvePoolIndex[USDC])
        );

        // Set the target chain to a CCTP enabled chain.
        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                POLY_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("RouteNotAvailable()"));
        engine.executeOrder(params);
    }

    function testCannotExecuteOrderNotAllowedRelayerCCTP() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Create list of allowed relayers.
        bytes32[] memory allowedRelayers = _createAllowedRelayerArray(5);

        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                POLY_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                allowedRelayers
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("NotAllowedRelayer()"));
        vm.prank(makeAddr("notAllowedRelayer"));
        engine.executeOrder(params);
    }

    function testCannotExecuteOrderUnregisteredOrderRouterCCTP() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                POLY_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Change the registered emitter address for the Arb chain.
        engine.registerOrderRouter(ARB_CHAIN, toUniversalAddress(makeAddr("badAddress")));

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("UnregisteredOrderRouter()"));
        engine.executeOrder(params);
    }

    function testCannotExecuteOrderUnregisteredOrderRouterNoTargetCCTP() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        // Send to an unregistered chain ID.
        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                69, // Unregistered chain ID.
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("UnregisteredOrderRouter()"));
        engine.executeOrder(params);
    }

    function testCannotExecuteOrderIsPausedCCTP() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;

        ICircleIntegration.RedeemParameters memory params = _craftValidCCTPMarketOrder(
            block.timestamp,
            amount,
            toUniversalAddress(NATIVE_ARB_USDC),
            ARB_ROUTER,
            ARB_CIRCLE_INTEGRATION,
            ARB_CHAIN,
            _encodeTestMarketOrder(
                amountOut, // Min amount out.
                POLY_CHAIN,
                redeemerMessage,
                RELAYER_FEE,
                new bytes32[](0)
            )
        );

        // Pause the engine.
        engine.setPause(true);

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("ContractPaused()"));
        engine.executeOrder(params);
    }

    function testCannotExecuteOrderIsPausedFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Pause the engine.
        engine.setPause(true);

        // Expect failure.
        vm.expectRevert(abi.encodeWithSignature("ContractPaused()"));
        vm.prank(fromRouter);
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteOrderUnregisteredOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(makeAddr("notARouter"));
        vm.expectRevert(); // No revert message, it appears there is a forge bug.
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteNonzeroRelayerFeeFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 69, // Nonzero relayer fee.
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(fromRouter);
        vm.expectRevert(abi.encodeWithSignature("InvalidRelayerFee()"));
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteSpecifiedAllowedRelayersFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        // Create a random list of allowed relayers.
        bytes32[] memory allowedRelayers = _createAllowedRelayerArray(5);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: allowedRelayers
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(fromRouter);
        vm.expectRevert(abi.encodeWithSignature("InvalidRelayerFee()"));
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteSwapFailedFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";

        // Set the amountOut to a value that is impossible to achieve.
        uint256 amountOut = amount;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(fromRouter);
        SafeERC20.safeIncreaseAllowance(IERC20(USDC), address(engine), amount);
        vm.expectRevert(abi.encodeWithSignature("SwapFailed()"));
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteInvalidRouteFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        // Disable the target route.
        engine.disableExecutionRoute(SUI_CHAIN);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(fromRouter);
        SafeERC20.safeIncreaseAllowance(IERC20(USDC), address(engine), amount);
        vm.expectRevert(abi.encodeWithSignature("InvalidRoute()"));
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteRouteNotAvailableFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        // Create a market order with a target chain that is CCTP enabled.
        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: ARB_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(fromRouter);
        SafeERC20.safeIncreaseAllowance(IERC20(USDC), address(engine), amount);
        vm.expectRevert(abi.encodeWithSignature("RouteNotAvailable()"));
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }

    function testCannotExecuteInvalidCCTPIndexFromOrderRouter() public {
        // Parameters.
        uint256 amount = INIT_LIQUIDITY / 2;
        bytes memory redeemerMessage = hex"deadbeef";
        uint256 amountOut = 0;
        address fromRouter = fromUniversalAddress(AVAX_ROUTER);

        // Update the avax-usdc token index to an invalid value.
        engine.updateCurvePool(ICurvePool(curvePool), 69);

        Messages.MarketOrder memory order = Messages.MarketOrder({
            minAmountOut: amountOut,
            targetChain: SUI_CHAIN,
            redeemer: toUniversalAddress(TEST_REDEEMER),
            redeemerMessage: redeemerMessage,
            sender: toUniversalAddress(TEST_SENDER),
            refundAddress: toUniversalAddress(TEST_RECIPIENT),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Execute the order.
        vm.deal(fromRouter, WORMHOLE_FEE);
        deal(USDC, fromRouter, amount);

        // Expect failure.
        vm.startPrank(fromRouter);
        SafeERC20.safeIncreaseAllowance(IERC20(USDC), address(engine), amount);
        vm.expectRevert(abi.encodeWithSignature("InvalidCCTPIndex()"));
        engine.executeOrder{value: WORMHOLE_FEE}(amount, order);
    }
}
