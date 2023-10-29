// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../src/interfaces/ITokenRouter.sol";
import {PlaceMarketOrderArgs} from "../../src/interfaces/IPlaceMarketOrder.sol";

contract TestTransfer is Script {
    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));
    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _router = vm.envAddress("RELEASE_ORDER_ROUTER_ADDRESS");

    // Transfer params.
    uint256 _amountIn = vm.envUint("TEST_AMOUNT_IN");
    uint256 _amountOut = vm.envUint("TEST_AMOUNT_OUT");
    uint16 _targetChain = uint16(vm.envUint("TEST_TARGET_CHAIN"));
    bytes32 _redeemer = vm.envBytes32("TEST_REDEEMER");
    address _refundAddress = vm.envAddress("TEST_REFUND_ADDRESS");
    bytes _redeemerMessage = hex"deadbeef";

    function transfer() public {
        SafeERC20.safeIncreaseAllowance(IERC20(_token), _router, _amountIn);
        ITokenRouter(_router).placeMarketOrder(
            PlaceMarketOrderArgs({
                amountIn: _amountIn,
                minAmountOut: _amountOut,
                targetChain: _targetChain,
                redeemer: _redeemer,
                refundAddress: _refundAddress,
                redeemerMessage: _redeemerMessage
            })
        );
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        transfer();

        // Done.
        vm.stopBroadcast();
    }
}
