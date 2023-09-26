// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";

interface curveFactory {
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

contract WormholeCurvePool {
	address constant curveFactoryAddress =
		0xb17b674D9c5CB2e441F8e196a2f048A81355d031;
	address constant usdc = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
	address constant ethUsdc = 0xB24CA28D4e2742907115fECda335b40dbda07a4C;
	address constant solUsdc = 0x0950Fc1AD509358dAeaD5eB8020a3c7d8b43b9DA;
	address constant polyUsdc = 0x543672E9CBEC728CBBa9C3Ccd99ed80aC3607FA8;
	address curvePool;

	constructor() {
		// Wormhole USDCs
		address[4] memory coins;
		coins[0] = usdc;
		coins[1] = ethUsdc;
		coins[2] = solUsdc;
		coins[3] = polyUsdc;

		uint256 A = 100;
		uint256 fee = 4000000;
		uint256 asset_type = 0;
		uint256 implementation_idx = 0;

		curvePool = curveFactory(curveFactoryAddress).deploy_plain_pool(
			"Mothership Test Pool", // Name
			"WormUSDC", // Symbol
			coins,
			A,
			fee,
			asset_type,
			implementation_idx
		);
	}

	function poolAddress() public view returns (address) {
		return curvePool;
	}
}
