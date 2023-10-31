// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {INativeSwap} from "../../src/interfaces/INativeSwap.sol";

contract RegisterNativeSwap is Script {
    address immutable _deployed = vm.envAddress("DEPLOYED");
    uint16 immutable _targetChain = uint16(vm.envUint("TARGET_CHAIN"));
    bytes32 immutable _target = vm.envBytes32("TARGET_ADDRESS");

    function register() public {
        INativeSwap(_deployed).registerContract(_targetChain, _target);
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        register();

        // Done.
        vm.stopBroadcast();
    }
}
