// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

interface ICurvePool {
	function add_liquidity(
		uint256[4] memory _amounts,
		uint256 _min_mint_amount
	) external returns (uint256);

	function exchange(
		int128 i,
		int128 j,
		uint256 _dx,
		uint256 _min_dy
	) external returns (uint256);
}
