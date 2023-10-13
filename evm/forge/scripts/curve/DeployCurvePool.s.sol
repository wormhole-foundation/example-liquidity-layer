// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ICurveFactory} from "curve-solidity/ICurveFactory.sol";

contract DeployCurvePool is Script {
    // Testnet addresses on Avax.
    address usdc = 0x5425890298aed601595a70AB815c96711a31Bc65;
    address wrappedEthUsdc = 0x63A30f239DC8d1c17Bf6653a68Fc6C2F83641E6d;
    address wrappedBscUsdc = 0xd1C5F207aC817b721FEfb978C6d55a1A2e8cf747;
    ICurveFactory immutable _curveFactory =
        ICurveFactory(0xd4A231Db402C5F0A4441D62F4683Aa6BEF8854ce);

    function deploy() public {
        uint256 A = 100;
        uint256 fee = 4000000;
        uint256 asset_type = 0;
        uint256 implementation_idx = 0;

        address[4] memory coins = [usdc, wrappedEthUsdc, wrappedBscUsdc, address(0)];

        address curvePool = _curveFactory.deploy_plain_pool(
            "Liquidity Layer Pool", // Name
            "WormUSDC", // Symbol
            coins,
            A,
            fee,
            asset_type,
            implementation_idx
        );

        console.log("Deployed to:", curvePool);
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        // Deploy curve pool.
        deploy();

        // Done.
        vm.stopBroadcast();
    }
}
