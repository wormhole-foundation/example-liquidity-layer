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
        address tokenBridgeAddress,
        address wormholeCctpAddress
    ) internal view {
        // Check that the expected chain ID for this deployment matches what the contracts know.
        ITokenBridge tokenBridge = ITokenBridge(tokenBridgeAddress);
        require(tokenBridge.chainId() == chain, "invalid token bridge chain ID");

        if (wormholeCctpAddress != address(0)) {
            ICircleIntegration circleIntegration = ICircleIntegration(wormholeCctpAddress);
            require(circleIntegration.chainId() == chain, "invalid wormhole cctp chain ID");
        }
    }
}
