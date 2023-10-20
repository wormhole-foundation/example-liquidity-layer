// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {OrderResponse, RedeemedFill} from "liquidity-layer/interfaces/IOrderRouter.sol";

interface INativeSwap {
    struct ExactInParameters {
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint256 targetAmountOutMinimum;
        bytes32 targetChainRecipient;
        uint256 deadline;
        uint24 poolFee;
    }

    struct RecvSwapInParameters {
        uint256 estimatedAmount;
        bytes32 recipientAddress;
        address[2] path;
        uint256 deadline;
        uint24 poolFee;
        uint256 relayerFee;
    }

    function swapExactNativeInAndTransfer(
        ExactInParameters calldata swapParams,
        address[] calldata path,
        uint16 targetChainId,
        uint256 wormholeSlippage
    ) external payable;

    function recvAndSwapExactNativeIn(
        OrderResponse calldata orderResponse
    ) external payable returns (uint256[] memory amounts);

    function handleOrderRevert(OrderResponse calldata response) external;

    function setRelayerFee(uint16 chainId, uint256 fee) external;

    function registerContract(uint16 chainId, bytes32 contractAddress) external;
}