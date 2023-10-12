// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import {ICurveFactory} from "curve-solidity/ICurveFactory.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";

contract WormholePoolTestHelper {
    address constant curveFactoryAddress = 0xb17b674D9c5CB2e441F8e196a2f048A81355d031;
    address immutable curvePool;

    constructor(address[4] memory coins) {
        uint256 A = 100;
        uint256 fee = 4000000;
        uint256 asset_type = 0;
        uint256 implementation_idx = 0;

        curvePool = ICurveFactory(curveFactoryAddress).deploy_plain_pool(
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
        return ICurvePool(curvePool).add_liquidity(amounts, minLPAmount);
    }

    function removeCurveLiquidity(
        uint256 amount,
        uint256[4] memory minAmounts
    ) internal returns (uint256[4] memory) {
        return ICurvePool(curvePool).remove_liquidity(amount, minAmounts);
    }

    function curveSwap(int128 i, int128 j, uint256 dx, uint256 min_dy) internal returns (uint256) {
        return ICurvePool(curvePool).exchange(i, j, dx, min_dy);
    }

    function get_amount_out(int128 i, int128 j, uint256 dx) internal view returns (uint256) {
        return ICurvePool(curvePool).get_dy(i, j, dx);
    }
}
