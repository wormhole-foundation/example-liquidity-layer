// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {NativeSwapV2} from "../../src/NativeSwapV2.sol";
import {NativeSwapV3} from "../../src/NativeSwapV3.sol";

contract DeployNativeSwap is Script {
    address immutable _swapRouter = vm.envAddress("SWAP_ROUTER");
    address immutable _wormhole = vm.envAddress("WORMHOLE");
    address immutable _usdc = vm.envAddress("USDC");
    address immutable _weth = vm.envAddress("WETH");
    address immutable _tokenRouter = vm.envAddress("TOKEN_ROUTER");
    bool immutable _isV3 = vm.envBool("IS_V3");

    function deploy() public {
        address nativeSwap;
        if (_isV3) {
            nativeSwap = address(
                new NativeSwapV3(
                    _swapRouter,
                    _wormhole,
                    _tokenRouter,
                    _usdc,
                    _weth
                )
                );
        } else {
            nativeSwap = address(
                new NativeSwapV2(
                    _swapRouter,
                    _wormhole,
                    _tokenRouter,
                    _usdc,
                    _weth
                )
            );
        }

        console.log("NativeSwap deployed to ", nativeSwap);
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        deploy();

        // Done.
        vm.stopBroadcast();
    }
}
