// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../src/interfaces/ITokenRouter.sol";

import {Utils} from "../../src/shared/Utils.sol";

contract TestPlaceFastMarketOrder is Script {
    using SafeERC20 for IERC20;
    using Utils for address;

    IERC20 immutable _token = IERC20(vm.envAddress("RELEASE_TOKEN_ADDRESS"));
    ITokenRouter immutable _router = ITokenRouter(vm.envAddress("RELEASE_TOKEN_ROUTER_ADDRESS"));

    function transfer() public {
        uint64 amountIn = 1000000; // 1.00
        uint64 maxFee = 690000; // 0.69

        uint256 balance = _token.balanceOf(msg.sender);
        console2.log("Balance: %s", balance);

        _token.safeIncreaseAllowance(address(_router), amountIn);

        uint16 targetChain = 5;
        bytes memory redeemerMessage = hex"deadbeef";
        _router.placeFastMarketOrder(
            amountIn,
            targetChain,
            msg.sender.toUniversalAddress(), // redeemer
            redeemerMessage,
            maxFee,
            uint32(0) // deadline
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
