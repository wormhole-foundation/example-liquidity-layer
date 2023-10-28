// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./Types.sol";
import "./IPlaceMarketOrder.sol";
import "./IRedeemFill.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

interface ITokenRouter is IPlaceMarketOrder, IRedeemFill {
    function getRouter(uint16 chain) external view returns (bytes32);

    function orderToken() external view returns (IERC20);

    function wormholeCctp() external view returns (ICircleIntegration);

    function wormholeChainId() external view returns (uint16);

    function isFillRedeemed(bytes32 fillHash) external view returns (bool);

    function addRouterEndpoint(uint16 chain, bytes32 router) external;

    function upgradeContract(address newImplementation) external;

    function getOwner() external view returns (address);

    function getPendingOwner() external view returns (address);

    function getOwnerAssistant() external view returns (address);

    function getDeployer() external view returns (address);

    function isPaused() external view returns (bool);

    function setPause(bool paused) external;

    function submitOwnershipTransferRequest(address newOwner) external;

    function cancelOwnershipTransferRequest() external;

    function confirmOwnershipTransferRequest() external;

    function updateOwnerAssistant(address newAssistant) external;

    function computeMinAmountOut(
        uint256 amountIn,
        uint16 targetChain,
        uint24 slippage,
        uint256 relayerFee
    ) external view returns (uint256);
}
