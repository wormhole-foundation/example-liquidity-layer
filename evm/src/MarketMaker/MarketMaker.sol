// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {
    TransferInfo,
    CampaignParameters,
    Campaign,
    Vault,
    Auction,
    Callback
} from "../interfaces/IMarketMakerTypes.sol";

// TODO: Figure out how to handle relayer withdrawals and when to allow them. 
// TODO: Account for relayer fees when rolling over positions between campaigns.
// TODO: Roll over campaign positions in `startCampaign` if noone called `deposit` or `withdraw`. 
// TODO: Add refund mechanism for delayed slow VAAs. 

abstract contract MarketMaker is State {
    using BytesParsing for bytes;

    constructor(
        address multiSig_,
        address token_,
        address relayer_,
        uint32 campaignDuration_,
        uint32 accountingPeriod_,
        uint24 performanceFee_,
        uint24 maxRelayerUtilization_,
        uint64 initialDeposit_
    )
        State(
            multiSig_,
            token_,
            relayer_,
            campaignDuration_,
            accountingPeriod_,
            performanceFee_,
            maxRelayerUtilization_,
            initialDeposit_
        )
    {}

    // ------------------------------ external -------------------------------------------

    /// @notice Can only deposit during second half of the withdrawal period.
    /// @dev A successful deposit should update the vault state for the new campaign,
    /// if it hasn't been updated already.
    function deposit(uint64 amount) external {
        if (amount == 0) {
            revert ErrInvalidDepositAmount(amount);
        }

        address sender = msg.sender;
        if (sender == _relayer) {
            revert ErrRelayerIsCaller();
        }

        _handleDeposit(amount, sender);

        // Transfer the funds from the user to the vault.
        SafeERC20.safeTransferFrom(_token, sender, address(this), amount);
    }

    /// @notice Can only withdraw during second half of withdrawal period.
    /// @dev A successful withdrawal should update the vault state for the new campaign,
    /// if it hasn't been updated already.
    function withdraw(uint64 amount) external {
        if (amount == 0) {
            revert ErrInvalidWithdrawalAmount(amount);
        }
        
        address sender = msg.sender;
        if (sender == _relayer) {
            revert ErrRelayerIsCaller();
        }

        _handleWithdrawal(amount, sender);

        // Transfer the funds from the vault to the user.
        SafeERC20.safeTransfer(_token, sender, amount);
    }

    function updateVault() external {}

    function collectFees() external {}

    // ------------------------------ Relayer Only -------------------------------------------

    /// @dev If no deposits/withdrawals take place during the accounting period, this method
    /// should be called to update the vault state for the new campaign.
    function startCampaign() external onlyRelayer {
        if (_params.currentCampaign == 0) {
            Campaign storage initialCampaign = _campaigns[_params.currentCampaign];

            // TODO: confirm the balance of USDC matches the initial deposit.
            initialCampaign.startBlock = uint32(block.number);
            initialCampaign.endBlock = uint32(block.number + _campaignDuration);
        } else {
            if (block.timestamp <= _campaigns[_params.currentCampaign].endBlock + _accountingPeriod)
            {
                revert ErrCannotStartCampaign();
            } else {
                _updateCampaignIndex();

                Campaign storage newCampaign = _campaigns[_params.currentCampaign];

                newCampaign.startBlock = uint32(block.number);
                newCampaign.endBlock = uint32(block.number + _campaignDuration);
            }
        }
    }

    function placeInitialBid(bytes calldata fastTransferVaa, uint64 feeBid) external onlyRelayer {
        // Cache to reduce SLOADs.
        uint64 campaignIndex = _params.currentCampaign;

        _isTradingEnabled(campaignIndex);

        // Parse relevant info from the `fastTransferVaa`. The MatchingEngine will verify the
        // wormhole message, we're going to assume that the relayer passed in a valid message.
        TransferInfo memory info = _parseTransferInfo(fastTransferVaa);

        Campaign storage campaign = _campaigns[campaignIndex];

        _hasSufficientFunds(campaign, info.amount, info.securityDeposit);

        _matchingEngine.placeInitialBid(fastTransferVaa, feeBid);

        // Update the vault state.
        _recordNewAuction(
            campaign, info.auctionId, info.amount, info.securityDeposit, campaignIndex, feeBid
        );
    }

    function improveBid(bytes calldata fastTransferVaa, uint64 feeBid) external onlyRelayer {
        // Cache to reduce SLOADs.
        uint64 campaignIndex = _params.currentCampaign;

        _isTradingEnabled(campaignIndex);

        // SECURITY: Since we are computing the hash of the VAA, we do not need to
        // verify the signatures. The matching engine does this when starting an auction.
        TransferInfo memory info = _parseTransferInfo(fastTransferVaa);

        // See if we already participated in the auction.
        Campaign storage campaign = _campaigns[campaignIndex];
        Auction storage auction = _auctions[info.auctionId];

        if (auction.amount == 0) {
            _hasSufficientFunds(campaign, info.amount, info.securityDeposit);

            _matchingEngine.improveBid(info.auctionId, feeBid);

            _recordNewAuction(
                campaign, info.auctionId, info.amount, info.securityDeposit, campaignIndex, feeBid
            );
        } else {
            // If we were outbid, we need to account for new funds being outlayed.
            if (auction.fundsReturned) {
                _hasSufficientFunds(campaign, info.amount, info.securityDeposit);

                campaign.outstanding += info.amount + info.securityDeposit;

                // Update the auction state.
                auction.fundsReturned = false;
                auction.returnedDeposit = 0;
            }

            // Improve our bid.
            _matchingEngine.improveBid(info.auctionId, feeBid);
            auction.auctionFee = feeBid;
        }
    }

    // ------------------------------ Matching Engine Only -----------------------------------

    function updateAuctionStatus(
        bytes32 auctionId,
        uint64 totalPenalty,
        uint64 additionalFee,
        Callback callbackType
    ) external onlyMatchingEngine {
        Campaign storage campaign = _campaigns[_params.currentCampaign];
        Auction storage auction = _auctions[auctionId];

        if (callbackType == Callback.WonAuction) {
            // Auction.
            if (additionalFee > 0) {
                auction.auctionFee += additionalFee;
            }
            auction.returnedDeposit = auction.securityDeposit - totalPenalty;
            auction.wonAuction = true;

            // Campaign.
            campaign.fees += auction.auctionFee;
            campaign.outstanding -= auction.returnedDeposit;
        } else if (callbackType == Callback.FeeOnly) {
            // We did not win the auction, this is being called because we were
            // awarded the initial auction fee.
            campaign.fees += additionalFee;
        } else if (callbackType == Callback.Outbid) {
            // Auction.
            auction.returnedDeposit = auction.securityDeposit;
            auction.fundsReturned = true;

            // Campaign.
            campaign.outstanding -= auction.amount + auction.returnedDeposit;
        } else if (callbackType == Callback.AuctionComplete) {
            // Auction
            auction.returnedDeposit = auction.securityDeposit - totalPenalty;
            auction.fundsReturned = true;

            // Campaign.
            campaign.outstanding -= auction.amount + auction.returnedDeposit;
        } else {
            revert ErrInvalidCallbackType();
        }
    }

    // ------------------------------ private -------------------------------------------

    function _isTradingEnabled(uint64 campaignIndex) private view {
        Campaign storage campaign = _campaigns[campaignIndex];

        if (campaignIndex == 0 && campaign.startBlock == 0) {
            revert ErrCampaignNotStarted();
        } else {
            if (block.timestamp > campaign.endBlock) {
                revert ErrCampaignNotActive();
            } else {
                return;
            }
        }
    }

    function _isWithdrawalPeriod(uint64 campaignIndex) private view {
        uint32 campaignEndBlock = _campaigns[campaignIndex].endBlock;

        // Calculate the withdrawal window.
        uint32 startBlock = campaignEndBlock + _accountingPeriod / 2;
        uint32 endBlock = campaignEndBlock + _accountingPeriod;

        if (block.number < startBlock || block.number > endBlock) {
            revert ErrDepositNotAllowed();
        } else {
            return;
        }
    }

    function _handleDeposit(uint64 amount, address sender) private {
        uint64 lastCampaignIndex = _params.currentCampaign;

        _isWithdrawalPeriod(lastCampaignIndex);

        // Cache to reduce SLOADs.
        uint64 nextCampaignIndex = lastCampaignIndex + 1;
        Campaign storage nextCampaign = _campaigns[nextCampaignIndex];
        uint64 nextCampaignDeposits = nextCampaign.deposits;

        if (nextCampaignDeposits > 0) {
            uint24 newUtilizationRatio = _calculateUtilization(
                _vaults[_relayer].amount[nextCampaignIndex], nextCampaignDeposits + amount
            );

            if (newUtilizationRatio >= _params.minUtilizationRatioBps) {
                nextCampaign.deposits += amount;
                _vaults[sender].amount[nextCampaignIndex] += amount;
            } else {
                revert ErrDepositNotAllowed();
            }
        } else {
            Campaign memory lastCampaign = _campaigns[lastCampaignIndex];

            Vault storage relayerVault = _vaults[_relayer];
            uint64 lastRelayerDeposit = relayerVault.amount[lastCampaignIndex];

            // Account for relayer's share of losses from the last campaign.
            uint64 newRelayerDeposit = lastRelayerDeposit
                - uint64(
                    uint256(lastCampaign.outstanding) * uint256(lastRelayerDeposit)
                        / lastCampaign.deposits
                );
            uint64 newDeposits = lastCampaign.deposits - lastCampaign.outstanding + amount;

            // Compute the utilization ratio with the new deposit and then update the state if
            // it's allowed.
            uint24 newUtilizationRatio = _calculateUtilization(lastRelayerDeposit, newDeposits);

            if (newUtilizationRatio >= _params.minUtilizationRatioBps) {
                nextCampaign.deposits = newDeposits;
                _vaults[_relayer].amount[nextCampaignIndex] = newRelayerDeposit;
                _vaults[sender].amount[nextCampaignIndex] = amount;
            } else {
                revert ErrDepositNotAllowed();
            }
        }
    }

    function _handleWithdrawal(uint64 amount, address sender) private {
        uint64 lastCampaignIndex = _params.currentCampaign;

        _isWithdrawalPeriod(lastCampaignIndex);

        // See if the position is too far out of sync to allow a withdrawal.
        Vault storage vault = _vaults[sender];
        uint64 lastUpdateIndex = vault.positionUpdateIndex;
        uint256 updateCount = lastCampaignIndex - lastUpdateIndex;

        if (updateCount > MAX_POSITION_UPDATES) {
            revert ErrPositionTooOutOfSync();
        }

        _updatePosition(lastUpdateIndex, updateCount, vault);


    }

    function _updatePosition(uint256 startIndex, uint256 updateCount, Vault storage vault)
        private
    {
        uint64 accruedFees = vault.accruedFees;
        uint64 userDepositAmount = vault.totalDeposited;

        for (uint256 i = 1; i < updateCount - 1;) {
            uint64 campaignIndex = uint64(startIndex + i);
            Campaign memory campaign = _campaigns[campaignIndex];

            // User new deposit amount.
            uint64 newDeposit = vault.amount[campaignIndex];
            uint64 totalDeposits = campaign.deposits;

            // Use the previous position to compute fees.
            accruedFees += uint64(
                uint256(campaign.fees) * uint256(userDepositAmount + newDeposit)
                    / totalDeposits
            );
            userDepositAmount -= uint64(
                uint256(campaign.outstanding)
                    * uint256(userDepositAmount + newDeposit) / totalDeposits
            );
            userDepositAmount += newDeposit;

            unchecked { ++i; }
        }

        // Update the vault state
        vault.accruedFees = accruedFees;
        vault.totalDeposited = userDepositAmount;
        vault.positionUpdateIndex = uint64(startIndex + updateCount);
    }

    function _calculateUtilization(uint64 relayerDeposits, uint64 deposits)
        private
        pure
        returns (uint24)
    {
        return uint24(MAX_BPS * uint256(relayerDeposits) / deposits);
    }

    function _hasSufficientFunds(Campaign storage campaign, uint256 amount, uint128 securityDeposit)
        private
        view
    {
        uint256 auctionAmount = uint256(securityDeposit) + amount;
        uint256 maxAvailable = campaign.deposits - campaign.outstanding;

        if (auctionAmount > maxAvailable) {
            revert ErrInsufficientFunds(auctionAmount, maxAvailable);
        }
    }

    function _parseTransferInfo(bytes memory encoded)
        private
        pure
        returns (TransferInfo memory info)
    {
        uint256 sigLength = 66;

        // The signature offset is 5 bytes.
        (uint256 numSignatures, uint256 sigOffset) = encoded.asUint8Unchecked(5);
        uint256 bodyOffset = sigOffset + sigLength * numSignatures;

        // Parse the body and compute the VAA hash (aka auctionId).
        (bytes memory body,) = encoded.sliceUnchecked(bodyOffset, encoded.length);
        info.auctionId = keccak256(abi.encodePacked(keccak256(body)));
        uint256 payloadOffset = bodyOffset + 51;

        // We can cast to uint64 since this contract should only faciliate transfers
        // of USDC with 6 decimals.
        uint128 amount;
        uint128 securityDeposit;
        (amount,) = encoded.asUint128Unchecked(payloadOffset + 1);
        (securityDeposit,) = encoded.asUint128Unchecked(payloadOffset + 171);
        info.amount = uint64(amount);
        info.securityDeposit = uint64(securityDeposit);
    }

    function _recordNewAuction(
        Campaign storage campaign,
        bytes32 auctionId,
        uint64 transferAmount,
        uint64 securityDeposit,
        uint64 campaignIndex,
        uint64 feeBid
    ) private {
        campaign.outstanding += transferAmount + securityDeposit;

        // Add the auction to the list of active auctions.
        _auctions[auctionId] = Auction({
            amount: transferAmount,
            auctionFee: feeBid,
            securityDeposit: securityDeposit,
            returnedDeposit: 0,
            campaign: campaignIndex,
            wonAuction: false,
            fundsReturned: false
        });
    }
}
