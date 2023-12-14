// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

error ErrCallerNotRelayer();

error ErrCallerNotMatchingEngine();

error ErrZeroAddress();

error ErrInvalidPerformanceFee();

error ErrInvalidMaxUtilizationRatio();

error ErrInvalidDepositAmount(uint128 amount);

error ErrInsufficientFunds(uint256 amount, uint256 available);

error ErrAlreadyHighestBidder();

error ErrInvalidCallbackType();
