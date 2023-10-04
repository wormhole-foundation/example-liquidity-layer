// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/StdUtils.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";
import {TestHelpers} from "./helpers/MatchingEngineTestHelpers.sol";

import {IMatchingEngine} from "../src/interfaces/IMatchingEngine.sol";
import {MatchingEngine} from "../src/MatchingEngine/MatchingEngine.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {WormholePoolTestHelper} from "curve-solidity/WormholeCurvePool.sol";
import {toUniversalAddress, fromUniversalAddress} from "../src/shared/Utils.sol";
import {SigningWormholeSimulator} from "modules/wormhole/WormholeSimulator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
	uint16 constant SUI_CHAIN = 21;
	uint16 constant ETH_CHAIN = 2;
	uint16 constant ARB_CHAIN = 23;
	uint16 constant POLY_CHAIN = 5;
	uint16 constant AVAX_CHAIN = 6;
	uint256 constant INIT_LIQUIDITY = 1_000_000 * 10 ** 6; // (1MM USDC)
	uint256 constant RELAYER_FEE = 5_000_000; // (5 USDC)
	uint256 constant WORMHOLE_FEE = 1e16;

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
		// Deploy the matching engine.
		MatchingEngine proxy = new MatchingEngine(
			TOKEN_BRIDGE,
			CIRCLE_INTEGRATION,
			curvePool,
			0 // USDC pool index
		);
		engine = IMatchingEngine(address(proxy));

		// Set the initial router.
		engine.registerOrderRouter(SUI_CHAIN, SUI_ROUTER);
		engine.registerOrderRouter(ARB_CHAIN, ARB_ROUTER);
		engine.registerOrderRouter(POLY_CHAIN, POLY_ROUTER);

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
	}

	function _setupWormholeSimulator() internal {
		wormholeSimulator = new SigningWormholeSimulator(engine.getWormhole(), GUARDIAN_SIGNER);
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

	function testEnableExecutionRoute() public {
		uint16 chainId = 69;
		address target = makeAddr("ethEmitter");
		bool cctp = true;
		int8 poolIndex = 1;

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
		bool cctp = true;
		int8 poolIndex = 1;

		vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
		engine.enableExecutionRoute(chainId, target, cctp, poolIndex);
	}

	function testCannotEnableExecutionRouteOwnerOnly() public {
		uint16 chainId = 69;
		address target = makeAddr("ethEmitter");
		bool cctp = true;
		int8 poolIndex = 1;

		vm.prank(makeAddr("robber"));
		vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
		engine.enableExecutionRoute(chainId, target, cctp, poolIndex);
	}

	function testDisableExecutionRoute() public {
		uint16 chainId = 69;
		address target = makeAddr("ethEmitter");
		bool cctp = true;
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

	function testCannotDisableExecutionRoute() public {
		uint16 chainId = 69;

		vm.prank(makeAddr("robber"));
		vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
		engine.disableExecutionRoute(chainId);
	}

	function testRegisterOrderRouter() public {
		uint16 chainId = 69;
		bytes32 router = bytes32(uint256(420));

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
			router = bytes32(uint256(69));

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

	function testCannotRegisterOrderRouterOwnerOnly() public {
		uint16 chainId = 69;
		bytes32 router = bytes32(uint256(420));

		vm.prank(makeAddr("robber"));
		vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
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

	function testCannotUpdateCurvePoolOwnerOnly() public {
		ICurvePool newCurvePool = ICurvePool(makeAddr("newCurvePool"));
		int8 newNativeTokenIndex = 1;

		vm.prank(makeAddr("robber"));
		vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
		engine.updateCurvePool(newCurvePool, newNativeTokenIndex);
	}

	function testSetPause() public {
		// Check initial pause state.
		{
			bool paused = engine.getPaused();
			assertEq(paused, false);
		}

		// Pause the contract.
		{
			engine.setPause(true);

			bool paused = engine.getPaused();
			assertEq(paused, true);
		}

		// Unpause the contract.
		{
			engine.setPause(false);

			bool paused = engine.getPaused();
			assertEq(paused, false);
		}
	}

	function testSubmitOwnershipTransferRequest() public {
		address newOwner = makeAddr("newOwner");

		// Check initial ownership state.
		{
			address owner = engine.getOwner();
			assertEq(owner, address(this));

			address pendingOwner = engine.getPendingOwner();
			assertEq(pendingOwner, address(0));
		}

		// Submit the ownership transfer request.
		{
			engine.submitOwnershipTransferRequest(newOwner);

			address pendingOwner = engine.getPendingOwner();
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

		address pendingOwner = engine.getPendingOwner();
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
		assertEq(engine.getOwner(), address(this));

		// Submit the ownership transfer request.
		engine.submitOwnershipTransferRequest(newOwner);

		// Confirm by pranking with the newOwner address.
		vm.prank(newOwner);
		engine.confirmOwnershipTransferRequest();

		assertEq(engine.getOwner(), newOwner);
		assertEq(engine.getPendingOwner(), address(0));
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
		_assertCircleIntegrationMessage(
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
		increaseWrappedSupply(toUsdc, amount);

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

		// We will use this amountOut as the minAmountOut for the order,
		// since there is no competing order flow in this test.
		uint256 amountOut = get_amount_out(
			engine.getCCTPIndex(),
			curvePoolIndex[toUsdc],
			amount - RELAYER_FEE
		);
		require(amountOut > 0, "invalid test");

		// Create a valid transfer from Sui to Polygon.
		// bytes memory signedOrder = _craftValidCCTPMarketOrder(
		// 	amount,
		// 	toUniversalAddress(NATIVE_ETH_USDC),
		// 	ETH_CHAIN,
		// 	SUI_ROUTER,
		// 	SUI_BRIDGE,
		// 	SUI_CHAIN,
		// 	_encodeTestMarketOrder(
		// 		amountOut, // Min amount out.
		// 		POLY_CHAIN,
		// 		redeemerMessage,
		// 		RELAYER_FEE,
		// 		new bytes32[](0)
		// 	)
		// );
	}
}
