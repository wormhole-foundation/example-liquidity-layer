// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";

contract CheckWormholeContracts {
    function requireValidChain(uint16 chain, address wormhole) internal view {
        require(IWormhole(wormhole).chainId() == chain, "invalid wormhole cctp chain ID");
    }
}
