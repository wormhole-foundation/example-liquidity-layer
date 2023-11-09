// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

error ErrInvalidWormholeMessage(string reason);

error ErrChainNotAllowed(uint16 chain);

error ErrInvalidEndpoint(bytes32 endpoint);

error ErrInvalidTargetRouter(uint16 chain);

error ErrInvalidSourceRouter(bytes32 sender, bytes32 expected);

error ErrBidPriceTooHigh(uint128 bidPrice, uint256 maxPrice);

error ErrAuctionPeriodExpired();

error ErrAuctionAlreadyStarted();

error ErrAuctionNotActive(bytes32 auctionId);

error ErrAuctionPeriodNotComplete();

error ErrNotHighestBidder();

error ErrVaaMismatch();

error ErrInvalidAuctionStatus();

error ErrInvalidEmitterForFastFill();

error ErrFastFillAlreadyRedeemed();

error ErrInvalidAuctionDuration();

error ErrInvalidAuctionGracePeriod(uint8 gracePeriod);

error ErrInvalidUserPenaltyRewardBps();

error ErrInvalidInitialPenaltyBps();
