// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./Types.sol";
import "./IPlaceMarketOrder.sol";
import "./IRedeemFill.sol";
import "./IRedeemOrderRevert.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {RouterInfo, TokenType, SlippageUpdate, OrderResponse} from "./Types.sol";

interface IOrderRouter is IPlaceMarketOrder, IRedeemFill, IRedeemOrderRevert {
    function MIN_SLIPPAGE() external view returns (uint24);

    function MAX_SLIPPAGE() external view returns (uint24);

    function MAX_AMOUNT() external view returns (uint256);

    function orderToken() external view returns (IERC20);

    function matchingEngineChain() external view returns (uint16);

    function matchingEngineEndpoint() external view returns (bytes32);

    function canonicalTokenChain() external view returns (uint16);

    function canonicalTokenAddress() external view returns (bytes32);

    function tokenBridge() external view returns (ITokenBridge);

    function wormholeCctp() external view returns (ICircleIntegration);

    function wormholeChainId() external view returns (uint16);

    function tokenType() external view returns (TokenType);

    function getRouterInfo(uint16 chain) external view returns (RouterInfo memory);

    function defaultRelayerFee() external view returns (uint256);

    function isFillRedeemed(bytes32 fillHash) external view returns (bool);

    function addRouterInfo(uint16 chain, RouterInfo memory info) external;

    function upgradeContract(address newImplementation) external;

    function updateSlippage(SlippageUpdate[] calldata update) external;

    function updateDefaultRelayerFee(uint256 fee) external;

    function getOwner() external view returns (address);

    function getOwnerAssistant() external view returns (address);

    function getDeployer() external view returns (address);
}
