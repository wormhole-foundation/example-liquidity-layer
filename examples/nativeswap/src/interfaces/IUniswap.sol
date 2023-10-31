// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';

interface IUniswapRouter is ISwapRouter {
    function refundETH() external payable;
}
