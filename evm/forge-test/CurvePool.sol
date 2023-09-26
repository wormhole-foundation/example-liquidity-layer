// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";

interface CurveFactory {
	function deploy_plain_pool(
		string memory _name,
		string memory _symbol,
		address[4] memory _coins,
		uint256 _A,
		uint256 _fee,
		uint256 _asset_type,
		uint256 _implementation_idx
	) external returns (address);
}

interface CurvePool {
	function add_liquidity(
		uint256[4] memory _amounts,
		uint256 _min_mint_amount
	) external returns (uint256);
}

contract WormholeCurvePool {
	address constant curveFactoryAddress =
		0xb17b674D9c5CB2e441F8e196a2f048A81355d031;
	address immutable curvePool;

	constructor(address[4] memory coins) {
		uint256 A = 100;
		uint256 fee = 4000000;
		uint256 asset_type = 0;
		uint256 implementation_idx = 0;

		curvePool = CurveFactory(curveFactoryAddress).deploy_plain_pool(
			"Mothership Test Pool", // Name
			"WormUSDC", // Symbol
			coins,
			A,
			fee,
			asset_type,
			implementation_idx
		);
	}

	function addCurveLiquidity(
		uint256[4] memory amounts,
		uint256 minLPAmount
	) internal returns (uint256) {
		return CurvePool(curvePool).add_liquidity(amounts, minLPAmount);
	}
}
