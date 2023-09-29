// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {toUniversalAddress} from "../src/Utils.sol";

import "../src/interfaces/IOrderRouter.sol";
import {OrderRouter} from "../src/OrderRouter/OrderRouter.sol";

contract OrderRouterTest is Test {
	address public constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;

	uint16 public constant MATCHING_ENGINE_CHAIN = 6;
	address public constant MATCHING_ENGINE_ADDRESS = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF;

	uint16 public constant CANONICAL_TOKEN_CHAIN = 2;
	address public constant CANONICAL_TOKEN_ADDRESS = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

	address public constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
	address public constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;

	OrderRouter router;

	function setUp() public {
		router = new OrderRouter(
			USDC_ADDRESS,
			MATCHING_ENGINE_CHAIN,
			toUniversalAddress(MATCHING_ENGINE_ADDRESS),
			CANONICAL_TOKEN_CHAIN,
			toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
			TOKEN_BRIDGE_ADDRESS,
			WORMHOLE_CCTP_ADDRESS
		);

		// TODO
	}

	function testCannotPlaceMarketOrderTargetChainNotSupported(
		uint256 amountIn,
		uint16 targetChain
	) public {
		deal(USDC_ADDRESS, address(this), amountIn);

		IERC20(USDC_ADDRESS).approve(address(router), amountIn);

		PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
			amountIn: amountIn,
			minAmountOut: amountIn,
			targetChain: targetChain,
			redeemer: bytes32(0),
			redeemerMessage: bytes("All your base are belong to us."),
			refundAddress: address(0)
		});

		vm.expectRevert(abi.encodeWithSelector(ErrTargetChainNotSupported.selector, targetChain));
		router.placeMarketOrder(args);
	}
}
