// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {WormholeCurvePool} from "./CurvePool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MatchingEngineTest is Test, WormholeCurvePool {
	address constant usdc = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
	address constant ethUsdc = 0xB24CA28D4e2742907115fECda335b40dbda07a4C;
	address constant solUsdc = 0x0950Fc1AD509358dAeaD5eB8020a3c7d8b43b9DA;
	address constant polyUsdc = 0x543672E9CBEC728CBBa9C3Ccd99ed80aC3607FA8;
	address[4] poolCoins;

	/// @notice We use a constructor here so that the curve pool is
	/// only deployed once (vs. in a `setUp` function).
	constructor() WormholeCurvePool([usdc, ethUsdc, solUsdc, polyUsdc]) {
		poolCoins = [usdc, ethUsdc, solUsdc, polyUsdc];
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

	function setUp() public {
		mintAndProvideLiquidity(5000000 * 10 ** 6);
	}

	function testDeez() public {
		uint256 amount = 5000;
		deal(poolCoins[0], address(this), amount);
		IERC20(poolCoins[0]).approve(curvePool, amount);

		uint256 amountOut = curveSwap(
			0, // usdc
			1, // eth
			5000,
			0
		);
	}
}
