// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {TokenType} from "./State.sol";

error ErrAmountTooLarge(uint256 amount, uint256 maximum);

error ErrInsufficientAmount(uint256 amount, uint256 minimum);

error ErrInvalidRedeemer(bytes32 redeemer, bytes32 expected);

error ErrInvalidSourceRouter(uint16 chain, TokenType tokenType, bytes32 fromAddress);

error ErrMinAmountOutExceedsLimit(uint256 minAmountOut, uint256 limit);

error ErrRouterSlippageTooHigh(uint64 slippage, uint64 maximum);

error ErrRouterSlippageTooLow(uint64 slippage, uint64 minimum);

error ErrSourceNotMatchingEngine(uint16 chain, bytes32 fromAddress);

error ErrTooManyRelayers(uint256 numRelayers, uint256 limit);

error ErrUnsupportedChain(uint16 chain);

error ErrZeroMinAmountOut();
