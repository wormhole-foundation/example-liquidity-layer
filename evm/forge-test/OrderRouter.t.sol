// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUSDC} from "cctp-solidity/IUSDC.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {SigningWormholeSimulator} from "wormhole-solidity/WormholeSimulator.sol";

import {Messages} from "../src/shared/Messages.sol";
import {toUniversalAddress} from "../src/shared/Utils.sol";

import "../src/interfaces/IOrderRouter.sol";
import {OrderRouter} from "../src/OrderRouter/OrderRouter.sol";

contract OrderRouterTest is Test {
	using Messages for *;

	address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;

	// Because this test is run using an Avalanche fork, we need to use a different chain ID for the
	// matching engine.
	uint16 constant MATCHING_ENGINE_CHAIN = 23;
	address constant MATCHING_ENGINE_ADDRESS = 0xBa5EdBA5eDBA5EdbA5edbA5EDBA5eDbA5edBa5Ed;

	uint16 constant CANONICAL_TOKEN_CHAIN = 2;
	address constant CANONICAL_TOKEN_ADDRESS = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

	address constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
	address constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;

	uint248 constant TESTING_TARGET_SLIPPAGE = 42069;
	bytes32 constant TESTING_TARGET_ENDPOINT =
		0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;

	uint256 constant MAX_UINT256 = 2 ** 256 - 1;

	OrderRouter nativeRouter;
	OrderRouter cctpEnabledRouter;
	OrderRouter canonicalEnabledRouter;

	SigningWormholeSimulator wormholeSimulator;

	ITokenBridge tokenBridge;
	ICircleIntegration wormholeCctp;

	function setUp() public {
		tokenBridge = ITokenBridge(TOKEN_BRIDGE_ADDRESS);
		wormholeCctp = ICircleIntegration(WORMHOLE_CCTP_ADDRESS);

		// Set up order routers. These routers will represent the different outbound paths.
		{
			// Prank with an arbitrary owner.
			vm.startPrank(makeAddr("owner"));
			nativeRouter = new OrderRouter(
				USDC_ADDRESS,
				MATCHING_ENGINE_CHAIN,
				toUniversalAddress(MATCHING_ENGINE_ADDRESS),
				CANONICAL_TOKEN_CHAIN,
				toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
				address(tokenBridge),
				address(0) // wormholeCctp
			);
			assert(nativeRouter.tokenType() == TokenType.Native);

			cctpEnabledRouter = new OrderRouter(
				USDC_ADDRESS,
				MATCHING_ENGINE_CHAIN,
				toUniversalAddress(MATCHING_ENGINE_ADDRESS),
				CANONICAL_TOKEN_CHAIN,
				toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
				address(tokenBridge),
				address(wormholeCctp)
			);
			assert(cctpEnabledRouter.tokenType() == TokenType.Cctp);

			canonicalEnabledRouter = new OrderRouter(
				_wrappedUsdc(),
				MATCHING_ENGINE_CHAIN,
				toUniversalAddress(MATCHING_ENGINE_ADDRESS),
				CANONICAL_TOKEN_CHAIN,
				toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
				address(tokenBridge),
				address(0)
			);
			assert(canonicalEnabledRouter.tokenType() == TokenType.Canonical);
			vm.stopPrank();
		}

		wormholeSimulator = new SigningWormholeSimulator(
			ITokenBridge(TOKEN_BRIDGE_ADDRESS).wormhole(),
			uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"))
		);
	}

	function testCannotAddEndpointAsRandomCaller(address notOwner) public {
		vm.assume(notOwner != makeAddr("owner"));

		vm.prank(notOwner);
		vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
		nativeRouter.addEndpoint(
			1,
			TESTING_TARGET_ENDPOINT,
			TargetInfo({tokenType: TokenType.Native, slippage: TESTING_TARGET_SLIPPAGE})
		);
	}

	function testCannotPlaceMarketOrderErrTargetChainNotSupported(
		uint256 amountIn,
		uint16 targetChain
	) public {
		_dealAndApproveUsdc(nativeRouter, amountIn);

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: amountIn,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		vm.expectRevert(abi.encodeWithSelector(ErrUnsupportedTargetChain.selector, targetChain));
		nativeRouter.placeMarketOrder(args);
	}

	function testCannotPlaceMarketOrderErrInsufficientAmount(uint256 amountIn) public {
		vm.assume(amountIn < uint256(TESTING_TARGET_SLIPPAGE));

		uint16 targetChain = 1;
		_registerTargetChain(nativeRouter, targetChain, TokenType.Native);

		_dealAndApproveUsdc(nativeRouter, amountIn);

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: amountIn,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		vm.expectRevert(
			abi.encodeWithSelector(
				ErrInsufficientAmount.selector,
				amountIn,
				TESTING_TARGET_SLIPPAGE
			)
		);
		nativeRouter.placeMarketOrder(args);
	}

	function testCannotPlaceMarketOrderErrMinAmountOutExceedsLimit(
		uint256 amountIn,
		uint256 excessAmount
	) public {
		amountIn = bound(amountIn, TESTING_TARGET_SLIPPAGE, MAX_UINT256);
		excessAmount = bound(excessAmount, 1, MAX_UINT256 - amountIn + TESTING_TARGET_SLIPPAGE);

		uint16 targetChain = 1;
		_registerTargetChain(nativeRouter, targetChain, TokenType.Native);

		_dealAndApproveUsdc(nativeRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE + excessAmount;

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		vm.expectRevert(
			abi.encodeWithSelector(
				ErrMinAmountOutExceedsLimit.selector,
				minAmountOut,
				amountIn - TESTING_TARGET_SLIPPAGE
			)
		);
		nativeRouter.placeMarketOrder(args);
	}

	function testCannotPlaceMarketOrderErrTooManyRelayers(uint256 numAllowedRelayers) public {
		numAllowedRelayers = bound(numAllowedRelayers, 9, 255);
		uint256 amountIn = 69420;
		uint256 relayerFee = 69;

		uint16 targetChain = 1;
		_registerTargetChain(nativeRouter, targetChain, TokenType.Native);

		_dealAndApproveUsdc(nativeRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE - relayerFee;

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		vm.expectRevert(
			abi.encodeWithSelector(
				ErrTooManyRelayers.selector,
				numAllowedRelayers,
				nativeRouter.MAX_NUM_RELAYERS()
			)
		);
		nativeRouter.placeMarketOrder(args, relayerFee, _makeAllowedRelayers(numAllowedRelayers));
	}

	function testNativeRouterPlaceMarketOrder(uint256 amountIn, uint8 targetTokenTypeInt) public {
		amountIn = bound(
			amountIn,
			TESTING_TARGET_SLIPPAGE,
			IERC20(USDC_ADDRESS).totalSupply() -
				ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS)
		);
		// This is a hack because forge tests cannot fuzz test enums yet.
		vm.assume(
			targetTokenTypeInt == uint8(TokenType.Native) ||
				targetTokenTypeInt == uint8(TokenType.Canonical) ||
				targetTokenTypeInt == uint8(TokenType.Cctp)
		);

		uint16 targetChain = 2;
		_registerTargetChain(nativeRouter, targetChain, TokenType(targetTokenTypeInt));

		_dealAndApproveUsdc(nativeRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: 0,
			allowedRelayers: new bytes32[](0)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory tokenBridgePayload = _placeMarketOrder(nativeRouter, args);
		_assertTokenBridgeMarketOrder(
			nativeRouter,
			6,
			USDC_ADDRESS,
			amountIn,
			tokenBridgePayload,
			expectedOrder
		);
	}

	function testNativeRouterPlaceMarketOrderWithRelayerFee(
		uint256 relayerFee,
		uint8 targetTokenTypeInt
	) public {
		uint256 amountIn = IERC20(USDC_ADDRESS).totalSupply() -
			ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS);
		relayerFee = bound(relayerFee, 1, amountIn - TESTING_TARGET_SLIPPAGE);
		// This is a hack because forge tests cannot fuzz test enums yet.
		vm.assume(
			targetTokenTypeInt == uint8(TokenType.Native) ||
				targetTokenTypeInt == uint8(TokenType.Canonical) ||
				targetTokenTypeInt == uint8(TokenType.Cctp)
		);

		uint16 targetChain = 2;
		_registerTargetChain(nativeRouter, targetChain, TokenType(targetTokenTypeInt));

		_dealAndApproveUsdc(nativeRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE - relayerFee,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: relayerFee,
			allowedRelayers: new bytes32[](0)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory tokenBridgePayload = _placeMarketOrderWithRelayerFee(
			nativeRouter,
			args,
			expectedOrder.relayerFee,
			expectedOrder.allowedRelayers
		);
		_assertTokenBridgeMarketOrder(
			nativeRouter,
			6,
			USDC_ADDRESS,
			amountIn,
			tokenBridgePayload,
			expectedOrder
		);
	}

	function testNativeRouterPlaceMarketOrderWithAllowedRelayers(
		uint256 numAllowedRelayers,
		uint8 targetTokenTypeInt
	) public {
		numAllowedRelayers = bound(numAllowedRelayers, 0, 8);
		uint256 amountIn = IERC20(USDC_ADDRESS).totalSupply() -
			ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS);
		uint256 relayerFee = amountIn / 2;
		// This is a hack because forge tests cannot fuzz test enums yet.
		vm.assume(
			targetTokenTypeInt == uint8(TokenType.Native) ||
				targetTokenTypeInt == uint8(TokenType.Canonical) ||
				targetTokenTypeInt == uint8(TokenType.Cctp)
		);

		uint16 targetChain = 2;
		_registerTargetChain(nativeRouter, targetChain, TokenType(targetTokenTypeInt));

		_dealAndApproveUsdc(nativeRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE - relayerFee,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: relayerFee,
			allowedRelayers: _makeAllowedRelayers(numAllowedRelayers)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory tokenBridgePayload = _placeMarketOrderWithRelayerFee(
			nativeRouter,
			args,
			expectedOrder.relayerFee,
			expectedOrder.allowedRelayers
		);
		_assertTokenBridgeMarketOrder(
			nativeRouter,
			6,
			USDC_ADDRESS,
			amountIn,
			tokenBridgePayload,
			expectedOrder
		);
	}

	function testCctpEnabledRouterPlaceMarketOrderTargetCctp(uint256 amountIn) public {
		amountIn = bound(amountIn, TESTING_TARGET_SLIPPAGE, _cctpBurnLimit());

		uint16 targetChain = 2;
		_registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Cctp);

		_dealAndApproveUsdc(cctpEnabledRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE;

		address refundAddress = makeAddr("Where's my money?");
		Messages.Fill memory expectedFill = Messages.Fill({
			sourceChain: cctpEnabledRouter.wormholeChain(),
			orderSender: toUniversalAddress(address(this)),
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us")
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: expectedFill.redeemer,
			redeemerMessage: expectedFill.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		//
		// NOTE: This is a special case where we send a fill directly to another order router.
		bytes memory wormholeCctpPayload = _placeMarketOrder(cctpEnabledRouter, args);
		ICircleIntegration.DepositWithPayload memory deposit = wormholeCctp
			.decodeDepositWithPayload(wormholeCctpPayload);

		// Check that the market order is encoded correctly.
		assertEq(deposit.payload, expectedFill.encode());

		// And check that the transfer is encoded correctly.
		ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
			.DepositWithPayload({
				token: toUniversalAddress(USDC_ADDRESS),
				amount: amountIn,
				sourceDomain: wormholeCctp.localDomain(),
				targetDomain: wormholeCctp.getDomainFromChainId(targetChain),
				nonce: deposit.nonce, // This nonce comes from Circle's bridge.
				fromAddress: toUniversalAddress(address(cctpEnabledRouter)),
				mintRecipient: cctpEnabledRouter.getEndpoint(targetChain),
				payload: deposit.payload
			});
		assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
	}

	function testCctpEnabledRouterPlaceMarketOrderTargetNative(uint256 amountIn) public {
		amountIn = bound(
			amountIn,
			TESTING_TARGET_SLIPPAGE,
			ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS)
		);

		uint16 targetChain = 5;
		_registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Native);

		_dealAndApproveUsdc(cctpEnabledRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: 0,
			allowedRelayers: new bytes32[](0)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory wormholeCctpPayload = _placeMarketOrder(cctpEnabledRouter, args);
		_assertWormholeCctpMarketOrder(
			cctpEnabledRouter,
			amountIn,
			wormholeCctpPayload,
			expectedOrder
		);
	}

	function testCctpEnabledRouterPlaceMarketOrderTargetCanonical(uint256 amountIn) public {
		amountIn = bound(
			amountIn,
			TESTING_TARGET_SLIPPAGE,
			ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS)
		);

		uint16 targetChain = 23;
		_registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Canonical);

		_dealAndApproveUsdc(cctpEnabledRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: 0,
			allowedRelayers: new bytes32[](0)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory wormholeCctpPayload = _placeMarketOrder(cctpEnabledRouter, args);
		_assertWormholeCctpMarketOrder(
			cctpEnabledRouter,
			amountIn,
			wormholeCctpPayload,
			expectedOrder
		);
	}

	function testCanonicalEnabledRouterPlaceMarketOrderTargetCanonical(uint256 amountIn) public {
		amountIn = bound(amountIn, TESTING_TARGET_SLIPPAGE, MAX_UINT256);

		uint16 targetChain = 23;
		_registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Canonical);

		_dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE;

		address refundAddress = makeAddr("Where's my money?");
		Messages.Fill memory expectedFill = Messages.Fill({
			sourceChain: cctpEnabledRouter.wormholeChain(),
			orderSender: toUniversalAddress(address(this)),
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us")
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: expectedFill.redeemer,
			redeemerMessage: expectedFill.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		//
		// NOTE: This is a special case where we send a fill directly to another order router.
		bytes memory tokenBridgePayload = _placeMarketOrder(canonicalEnabledRouter, args);
		ITokenBridge.TransferWithPayload memory transfer = tokenBridge.parseTransferWithPayload(
			tokenBridgePayload
		);

		assertEq(transfer.payload, expectedFill.encode());

		ITokenBridge.TransferWithPayload memory expectedTransfer = ITokenBridge
			.TransferWithPayload({
				payloadID: 3,
				amount: amountIn,
				tokenAddress: toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
				tokenChain: CANONICAL_TOKEN_CHAIN,
				to: canonicalEnabledRouter.getEndpoint(targetChain),
				toChain: targetChain,
				fromAddress: toUniversalAddress(address(canonicalEnabledRouter)),
				payload: transfer.payload
			});
		assertEq(keccak256(abi.encode(transfer)), keccak256(abi.encode(expectedTransfer)));
	}

	function testCanonicalEnabledRouterPlaceMarketOrderTargetNative(uint256 amountIn) public {
		amountIn = bound(amountIn, TESTING_TARGET_SLIPPAGE, MAX_UINT256);

		uint16 targetChain = 5;
		_registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Native);

		_dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: 0,
			allowedRelayers: new bytes32[](0)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory tokenBridgePayload = _placeMarketOrder(canonicalEnabledRouter, args);
		_assertTokenBridgeMarketOrder(
			canonicalEnabledRouter,
			CANONICAL_TOKEN_CHAIN,
			CANONICAL_TOKEN_ADDRESS,
			amountIn,
			tokenBridgePayload,
			expectedOrder
		);
	}

	function testCanonicalEnabledRouterPlaceMarketOrderTargetCctp(uint256 amountIn) public {
		amountIn = bound(amountIn, TESTING_TARGET_SLIPPAGE, MAX_UINT256);

		uint16 targetChain = 2;
		_registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Cctp);

		_dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

		address refundAddress = makeAddr("Where's my money?");
		Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
			minAmountOut: amountIn - TESTING_TARGET_SLIPPAGE,
			targetChain: targetChain,
			redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
			redeemerMessage: bytes("All your base are belong to us"),
			sender: toUniversalAddress(address(this)),
			refundAddress: toUniversalAddress(refundAddress),
			relayerFee: 0,
			allowedRelayers: new bytes32[](0)
		});

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: expectedOrder.minAmountOut,
			targetChain: expectedOrder.targetChain,
			redeemer: expectedOrder.redeemer,
			redeemerMessage: expectedOrder.redeemerMessage,
			refundAddress: refundAddress
		});

		// Check that the payload is correct.
		bytes memory tokenBridgePayload = _placeMarketOrder(canonicalEnabledRouter, args);
		_assertTokenBridgeMarketOrder(
			canonicalEnabledRouter,
			CANONICAL_TOKEN_CHAIN,
			CANONICAL_TOKEN_ADDRESS,
			amountIn,
			tokenBridgePayload,
			expectedOrder
		);
	}

	function _dealAndApproveUsdc(OrderRouter router, uint256 amount) internal {
		deal(USDC_ADDRESS, address(this), amount);
		IERC20(USDC_ADDRESS).approve(address(router), amount);
	}

	function _registerTargetChain(OrderRouter router, uint16 chain, TokenType tokenType) internal {
		vm.prank(makeAddr("owner"));
		router.addEndpoint(
			chain,
			TESTING_TARGET_ENDPOINT,
			TargetInfo({tokenType: tokenType, slippage: TESTING_TARGET_SLIPPAGE})
		);
	}

	// NOTE: This method is not "view" because assertGt is internal.
	function _cctpBurnLimit() internal returns (uint256 limit) {
		limit = ICircleIntegration(WORMHOLE_CCTP_ADDRESS)
			.circleBridge()
			.localMinter()
			.burnLimitsPerMessage(USDC_ADDRESS);

		// Having this check prevents us forking a network where Circle has not set a burn limit.
		assertGt(limit, 0);
	}

	function _wrappedUsdc() internal view returns (address) {
		return
			ITokenBridge(TOKEN_BRIDGE_ADDRESS).wrappedAsset(
				CANONICAL_TOKEN_CHAIN,
				bytes32(uint256(uint160(CANONICAL_TOKEN_ADDRESS)))
			);
	}

	function _dealAndApproveWrappedUsdc(OrderRouter router, uint256 amount) internal {
		// First deal amount to this contract.
		deal(_wrappedUsdc(), address(this), amount);

		// Total supply is stored in slot 3. We need the supply of the Token Bridge wrapped USDC to
		// reflect however much we dealt. Otherwise we get arithmetic errors when Token Bridge tries
		// to burn its assets.
		vm.store(_wrappedUsdc(), bytes32(uint256(3)), bytes32(amount));

		// Approve the router for spending.
		IERC20(_wrappedUsdc()).approve(address(router), amount);
	}

	function _placeMarketOrder(
		OrderRouter router,
		PlaceMarketOrderArgs memory args
	) internal returns (bytes memory) {
		return _placeMarketOrderWithRelayerFee(router, args, 0, new bytes32[](0));
	}

	function _placeMarketOrderWithRelayerFee(
		OrderRouter router,
		PlaceMarketOrderArgs memory args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (bytes memory) {
		// Record logs for placeMarketOrder.
		vm.recordLogs();

		// Place the order.
		router.placeMarketOrder(args, relayerFee, allowedRelayers);

		// Fetch the logs for Wormhole message.
		Vm.Log[] memory logs = vm.getRecordedLogs();
		assertGt(logs.length, 0);

		return
			wormholeSimulator
				.parseVMFromLogs(wormholeSimulator.fetchWormholeMessageFromLog(logs)[0])
				.payload;
	}

	function _assertTokenBridgeMarketOrder(
		OrderRouter router,
		uint16 tokenChain,
		address tokenAddress,
		uint256 amountIn,
		bytes memory wormholePayload,
		Messages.MarketOrder memory expectedOrder
	) internal {
		ITokenBridge.TransferWithPayload memory transfer = tokenBridge.parseTransferWithPayload(
			wormholePayload
		);

		// Check that the market order is encoded correctly.
		assertEq(transfer.payload, expectedOrder.encode());

		// And check that the transfer is encoded correctly.
		ITokenBridge.TransferWithPayload memory expectedTransfer = ITokenBridge
			.TransferWithPayload({
				payloadID: 3,
				amount: amountIn,
				tokenAddress: toUniversalAddress(tokenAddress),
				tokenChain: tokenChain,
				to: toUniversalAddress(MATCHING_ENGINE_ADDRESS),
				toChain: MATCHING_ENGINE_CHAIN,
				fromAddress: toUniversalAddress(address(router)),
				payload: transfer.payload
			});
		assertEq(keccak256(abi.encode(transfer)), keccak256(abi.encode(expectedTransfer)));
	}

	function _assertWormholeCctpMarketOrder(
		OrderRouter router,
		uint256 amountIn,
		bytes memory wormholePayload,
		Messages.MarketOrder memory expectedOrder
	) internal {
		ICircleIntegration.DepositWithPayload memory deposit = wormholeCctp
			.decodeDepositWithPayload(wormholePayload);

		// Check that the market order is encoded correctly.
		assertEq(deposit.payload, expectedOrder.encode());

		// And check that the transfer is encoded correctly.
		ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
			.DepositWithPayload({
				token: toUniversalAddress(USDC_ADDRESS),
				amount: amountIn,
				sourceDomain: wormholeCctp.localDomain(),
				targetDomain: wormholeCctp.getDomainFromChainId(MATCHING_ENGINE_CHAIN),
				nonce: deposit.nonce, // This nonce comes from Circle's bridge.
				fromAddress: toUniversalAddress(address(router)),
				mintRecipient: toUniversalAddress(MATCHING_ENGINE_ADDRESS),
				payload: deposit.payload
			});
		assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
	}

	function _makeAllowedRelayers(
		uint256 numAllowedRelayers
	) internal pure returns (bytes32[] memory) {
		bytes32[] memory allowedRelayers = new bytes32[](numAllowedRelayers);
		for (uint256 i = 0; i < numAllowedRelayers; ++i) {
			allowedRelayers[i] = bytes32(i + 1);
		}
		return allowedRelayers;
	}
}
