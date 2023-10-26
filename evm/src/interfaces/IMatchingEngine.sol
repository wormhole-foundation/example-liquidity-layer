// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {Messages} from "../shared/Messages.sol";

interface IMatchingEngine {
    struct Route {
        bytes32 router;
        address target;
        bool cctp;
        int8 poolIndex;
    }

    enum RevertType {
        SwapFailed
    }

    function executeOrder(bytes calldata vaa) external payable returns (uint64 sequence);

    function executeOrder(
        ICircleIntegration.RedeemParameters calldata redeemParams
    ) external payable returns (uint64 sequence);

    function executeOrder(
        uint256 amount,
        Messages.MarketOrder memory order
    ) external payable returns (uint64 sequence);

    function enableExecutionRoute(
        uint16 chainId,
        bytes32 router,
        address target,
        bool cctp,
        int8 poolIndex
    ) external;

    function disableExecutionRoute(uint16 chainId_) external;

    function updateNativePoolInfo(
        uint16 chainId_,
        int8 nativeTokenIndex_,
        address nativeTokenAddress_
    ) external;

    function updateCurvePoolAddress(uint16 chainId_, address curvePool) external;

    function upgradeContract(address newImplementation) external;

    function updateOwnerAssistant(address newAssistant) external;

    function setPause(bool paused) external;

    function submitOwnershipTransferRequest(address newOwner) external;

    function cancelOwnershipTransferRequest() external;

    function confirmOwnershipTransferRequest() external;

    function registerDefaultRelayer(address relayer, bool shouldRegister) external;

    function chainId() external view returns (uint16);

    function wormhole() external view returns (IWormhole);

    function tokenBridge() external view returns (ITokenBridge);

    function circleIntegration() external view returns (ICircleIntegration);

    function isDefaultRelayer(address relayer) external view returns (bool);

    function getExecutionRoute(uint16 chainId_) external view returns (Route memory);

    function getOrderRouter(uint16 chainId_) external view returns (bytes32);

    function getCurvePoolAddress(uint16 chainId_) external view returns (address);

    function getCCTPIndex() external view returns (int128);

    function getNativeTokenAddress() external view returns (address);

    function owner() external view returns (address);

    function ownerAssistant() external view returns (address);

    function pendingOwner() external view returns (address);

    function isPaused() external view returns (bool);

    function RELAY_TIMEOUT() external view returns (uint256);
}
