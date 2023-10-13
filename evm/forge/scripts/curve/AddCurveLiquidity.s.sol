// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AddCurveLiquidity is Script {
    uint256 constant AMOUNT_6_DECIMALS = 1e8;
    uint256 constant AMOUNT_18_DECIMALS = 1e20;

    // Avax testnet curve pool.
    ICurvePool immutable _curvePool = ICurvePool(0xC58Df242850e9D449778Ef2f1C48f64a9B3d0D8d);

    function addLiquidity() public {
        uint256[3] memory amounts = [AMOUNT_6_DECIMALS, AMOUNT_6_DECIMALS, AMOUNT_18_DECIMALS];
        address[3] memory tokens = [
            0x5425890298aed601595a70AB815c96711a31Bc65, // Avax usdc
            0x63A30f239DC8d1c17Bf6653a68Fc6C2F83641E6d, // Wrapped Eth usdc
            0xd1C5F207aC817b721FEfb978C6d55a1A2e8cf747 // Wrapped Bsc usdc
        ];

        // Approve tokens.
        for (uint256 i = 0; i < 3; i++) {
            IERC20(tokens[i]).approve(address(_curvePool), amounts[i]);
        }

        // Add liquidity.
        uint256 shares = _curvePool.add_liquidity(amounts, 0);
        console2.log("Added liquidity. Shares:", shares);
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        // Add liquidity to curve pool.
        addLiquidity();

        // Done.
        vm.stopBroadcast();
    }
}
