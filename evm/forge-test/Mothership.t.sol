// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import {WormholeCurvePool} from "./CurvePool.sol";

contract MothershipTest is Test {
	WormholeCurvePool pool;

	/// @notice We use a constructor here so that the curve pool is
	/// only deployed once (vs. in a `setUp` function).
	constructor() {
		pool = new WormholeCurvePool();
	}

	function testCurvePool() public {
		assertTrue(pool.poolAddress() != address(0));
	}
}
