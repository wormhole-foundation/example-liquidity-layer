// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "src/interfaces/ITokenRouter.sol";

contract TestTransfer is Script {
    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));
    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _router = vm.envAddress("RELEASE_TOKEN_ROUTER_ADDRESS");

    // Transfer params.
    uint256 _amountIn = vm.envUint("TEST_AMOUNT_IN");
    uint16 _targetChain = uint16(vm.envUint("TEST_TARGET_CHAIN"));
    bytes32 _redeemer = vm.envBytes32("TEST_REDEEMER");
    bool isFast = vm.envBool("TEST_IS_FAST");
    bytes _redeemerMessage = hex"deadbeef";
    uint128 _baseAuctionPrice = uint128(vm.envUint("TEST_BASE_AUCTION_PRICE"));
    uint32 _deadline = uint32(vm.envUint("TEST_DEADLINE"));

    function transfer() public {
        SafeERC20.safeIncreaseAllowance(IERC20(_token), _router, _amountIn);
        if (isFast) {
            ITokenRouter(_router).placeFastMarketOrder(
                _amountIn, _targetChain, _redeemer, _redeemerMessage, _baseAuctionPrice, _deadline
            );
        } else {
            ITokenRouter(_router).placeMarketOrder(
                _amountIn, _targetChain, _redeemer, _redeemerMessage
            );
        }
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        transfer();

        // Done.
        vm.stopBroadcast();
    }
}
