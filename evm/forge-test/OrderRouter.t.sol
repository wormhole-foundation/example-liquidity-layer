// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {toUniversalAddress} from "../src/Utils.sol";

import "../src/interfaces/IOrderRouter.sol";
import {OrderRouter} from "../src/OrderRouter/OrderRouter.sol";

contract OrderRouterTest is Test {
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

	function setUp() public {
		nativeRouter = new OrderRouter(
			USDC_ADDRESS,
			MATCHING_ENGINE_CHAIN,
			toUniversalAddress(MATCHING_ENGINE_ADDRESS),
			CANONICAL_TOKEN_CHAIN,
			toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
			TOKEN_BRIDGE_ADDRESS,
			address(0) // wormholeCctp
		);
		assert(nativeRouter.tokenType() == TokenType.Native);

		cctpEnabledRouter = new OrderRouter(
			USDC_ADDRESS,
			MATCHING_ENGINE_CHAIN,
			toUniversalAddress(MATCHING_ENGINE_ADDRESS),
			CANONICAL_TOKEN_CHAIN,
			toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
			TOKEN_BRIDGE_ADDRESS,
			WORMHOLE_CCTP_ADDRESS
		);
		assert(cctpEnabledRouter.tokenType() == TokenType.Cctp);

		address wrappedUsdc = ITokenBridge(TOKEN_BRIDGE_ADDRESS).wrappedAsset(
			CANONICAL_TOKEN_CHAIN,
			bytes32(uint256(uint160(CANONICAL_TOKEN_ADDRESS)))
		);
		canonicalEnabledRouter = new OrderRouter(
			wrappedUsdc,
			MATCHING_ENGINE_CHAIN,
			toUniversalAddress(MATCHING_ENGINE_ADDRESS),
			CANONICAL_TOKEN_CHAIN,
			toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
			TOKEN_BRIDGE_ADDRESS,
			address(0)
		);
		assert(canonicalEnabledRouter.tokenType() == TokenType.Canonical);
	}

	function testCannotAddEndpointAsRandomCaller(address notOwner) public {
		vm.assume(notOwner != address(this));

		vm.prank(notOwner);
		vm.expectRevert("Ownable: caller is not the owner");
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

		vm.expectRevert(abi.encodeWithSelector(ErrTargetChainNotSupported.selector, targetChain));
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
		vm.assume(amountIn >= TESTING_TARGET_SLIPPAGE);
		vm.assume(excessAmount > 0);
		vm.assume(excessAmount <= MAX_UINT256 - amountIn + TESTING_TARGET_SLIPPAGE);

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

	function testPlaceMarketOrderNativeTargetCctp() public {
		// TODO: Fix this to fuzz test amount.
		uint256 amountIn = 12345678;

		uint16 targetChain = 2;
		_registerTargetChain(nativeRouter, targetChain, TokenType.Cctp);

		_dealAndApproveUsdc(nativeRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE;

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		nativeRouter.placeMarketOrder(args);

		// TODO: check logs for encoded message.
	}

	function testPlaceMarketOrderNativeTargetNonCctp() public {
		// TODO: Fix this to fuzz test amount.
		uint256 amountIn = 12345678;

		uint16 targetChain = 1;
		_registerTargetChain(nativeRouter, targetChain, TokenType.Native);

		_dealAndApproveUsdc(nativeRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE;

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		nativeRouter.placeMarketOrder(args);

		// TODO: check logs for encoded message.
	}

	function testPlaceMarketOrderNativeTargetCanonical() public {
		// TODO: Fix this to fuzz test amount.
		uint256 amountIn = 12345678;

		uint16 targetChain = 1;
		_registerTargetChain(nativeRouter, targetChain, TokenType.Canonical);

		_dealAndApproveUsdc(nativeRouter, amountIn);

		uint256 minAmountOut = amountIn - TESTING_TARGET_SLIPPAGE;

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: minAmountOut,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		nativeRouter.placeMarketOrder(args);

		// TODO: check logs for encoded message.
	}

	function _dealAndApproveUsdc(OrderRouter router, uint256 amount) internal {
		deal(USDC_ADDRESS, address(this), amount);
		IERC20(USDC_ADDRESS).approve(address(router), amount);
	}

	function _registerTargetChain(OrderRouter router, uint16 chain, TokenType tokenType) internal {
		router.addEndpoint(
			chain,
			TESTING_TARGET_ENDPOINT,
			TargetInfo({tokenType: tokenType, slippage: TESTING_TARGET_SLIPPAGE})
		);
	}
}
