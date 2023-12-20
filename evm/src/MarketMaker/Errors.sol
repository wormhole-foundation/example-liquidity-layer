// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

error ErrCallerNotRelayer();

error ErrCallerNotMatchingEngine();

error ErrZeroAddress();

error ErrInvalidPerformanceFee();

error ErrInvalidMinUtilizationRatio();

error ErrInvalidDepositAmount(uint64 amount);

error ErrInsufficientFunds(uint256 amount, uint256 available);

error ErrAlreadyHighestBidder();

error ErrInvalidCallbackType();

error ErrInvalidCampaignDuration();

error ErrInvalidAccountingPeriod();

error ErrCampaignNotStarted();

error ErrCampaignNotActive();

error ErrCannotStartCampaign();

error ErrDepositNotAllowed();

error ErrInvalidWithdrawalAmount(uint64 amount);

error ErrPositionTooOutOfSync();

error ErrRelayerIsCaller();
