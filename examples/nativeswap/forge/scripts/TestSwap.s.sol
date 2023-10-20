// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {INativeSwap} from "../../src/interfaces/INativeSwap.sol";
import {IOrderRouter} from "liquidity-layer/interfaces/IOrderRouter.sol";

contract TestSwap is Script {
    address immutable _deployed = vm.envAddress("DEPLOYED");
    address immutable _orderRouter = vm.envAddress("ORDER_ROUTER");
    address immutable _usdc = vm.envAddress("USDC");
    address immutable _wrappedNative = vm.envAddress("WETH");

    // Swap parameters.
    uint256 immutable _amountIn = vm.envUint("AMOUNT_IN");
    uint256 immutable _amountOutMinimum = vm.envUint("AMOUNT_OUT_MIN");
    uint16 immutable _targetChain = uint16(vm.envUint("TARGET_SWAP_CHAIN"));
    uint256 immutable _targetAmountOutMinimum = vm.envUint("TARGET_AMOUNT_OUT_MIN");
    bytes32 immutable _recipient = vm.envBytes32("TARGET_RECIPIENT");
    uint24 immutable _poolFee = uint24(vm.envUint("POOL_FEE"));
    uint256 immutable deadline = block.timestamp + 1800;
    address immutable _targetWrappedNative = vm.envAddress("TARGET_WETH");
    address immutable _targetUsdc = vm.envAddress("TARGET_USDC");

    function buildPath() internal view returns (address[] memory path) {
        path = new address[](4);
        path[0] = _wrappedNative;
        path[1] = _usdc;
        path[2] = _targetUsdc;
        path[3] = _targetWrappedNative;
    }

    function swap() public {
        // Compute liquidity layer slippage.
        uint256 liquidityLayerMinAmountOut = IOrderRouter(_orderRouter).computeMinAmountOut(
            _amountOutMinimum,
            _targetChain,
            0, // Use default slippage
            0 // Use default relayer fee.
        );

        // Swap.
        INativeSwap(_deployed).swapExactNativeInAndTransfer{value: _amountIn}(
            INativeSwap.ExactInParameters({
                amountIn: _amountIn,
                amountOutMinimum: _amountOutMinimum,
                targetAmountOutMinimum: _targetAmountOutMinimum,
                targetChainRecipient: _recipient,
                deadline: deadline,
                poolFee: _poolFee
            }),
            buildPath(),
            _targetChain,
            _amountOutMinimum - liquidityLayerMinAmountOut
        );
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        swap();

        // Done.
        vm.stopBroadcast();
    }
}