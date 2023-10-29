// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

contract CheckWormholeContracts {
    function requireValidChain(
        uint16 chain,
        address wormholeCctpAddress
    ) internal view {
        ICircleIntegration circleIntegration = ICircleIntegration(wormholeCctpAddress);
        require(circleIntegration.chainId() == chain, "invalid wormhole cctp chain ID");
    }
}
