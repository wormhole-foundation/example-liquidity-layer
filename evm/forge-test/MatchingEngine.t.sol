// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IMatchingEngine} from "../src/interfaces/IMatchingEngine.sol";
import {WormholeCurvePool} from "./CurvePool.sol";
import {MatchingEngine} from "../src/MatchingEngine/MatchingEngine.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MatchingEngineTest is Test, WormholeCurvePool {
	// Pool info.
	address constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
	address constant ETH_USDC = 0xB24CA28D4e2742907115fECda335b40dbda07a4C;
	address constant SOL_USDC = 0x0950Fc1AD509358dAeaD5eB8020a3c7d8b43b9DA;
	address constant POLY_USDC = 0x543672E9CBEC728CBBa9C3Ccd99ed80aC3607FA8;
	address constant TOKEN_BRIDGE = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
	address constant CIRCLE_INTEGRATION = 0x09Fb06A271faFf70A651047395AaEb6265265F13;
	address[4] poolCoins;

	// Test Variables.
	uint256 constant INIT_LIQUIDITY = 1000000 * 10 ** 6; // (1MM USDC)
	IMatchingEngine engine;

	/// @notice We use a constructor here so that the curve pool is
	/// only deployed once (vs. in a `setUp` function).
	constructor() WormholeCurvePool([USDC, ETH_USDC, SOL_USDC, POLY_USDC]) {
		poolCoins = [USDC, ETH_USDC, SOL_USDC, POLY_USDC];
	}

	function mintAndProvideLiquidity(uint256 amount) internal {
		// Mint tokens and approve them for the curve pool.
		uint256[4] memory amounts;
		for (uint256 i = 0; i < poolCoins.length; ++i) {
			deal(poolCoins[i], address(this), amount);
			IERC20(poolCoins[i]).approve(curvePool, amount);
			amounts[i] = amount;
		}

		addCurveLiquidity(
			amounts,
			0 // minimum LP shares
		);
	}

	function deployMatchingEngine() internal {
		// Deploy the matching engine.
		MatchingEngine proxy = new MatchingEngine(
			TOKEN_BRIDGE,
			CIRCLE_INTEGRATION,
			curvePool,
			0 // USDC pool index
		);
		engine = IMatchingEngine(address(proxy));

		// Add CCTP and 2 non-CCTP enabled routes.
		// Add the curve pool information.
		// Add the order router information.
		// Add token routes.
	}

	function setUp() public {
		mintAndProvideLiquidity(INIT_LIQUIDITY);
		deployMatchingEngine();
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
}
