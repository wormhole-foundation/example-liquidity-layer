// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {
    TransferInfo, Vault, Deposit, Auction, Callback
} from "../interfaces/IMarketMakerTypes.sol";

abstract contract MarketMaker is State {
    using BytesParsing for bytes;

    constructor(
        address multiSig_,
        address token_,
        address relayer_,
        uint24 performanceFee_,
        uint24 maxRelayerUtilization_,
        uint64 initialDeposit_
    )
        State(multiSig_, token_, relayer_, performanceFee_, maxRelayerUtilization_, initialDeposit_)
    {}

    // ------------------------------ external -------------------------------------------

    function deposit(uint128 amount) external {
        if (amount == 0) {
            revert ErrInvalidDepositAmount(amount);
        }

        Vault storage vault = _vault;
        Deposit storage deposited = _deposits[msg.sender];

        /**
         * Update state for the depositor. We must accrue fees before updating the
         * amount, otherwise we will overestimate the accrued fees. We also must
         * update the total fees after accruing fees, otherwise this account
         * will be attributed extra fees at a later time.
         */
        deposited.accruedFees += _calculateAccruedFees(deposited, vault);
        deposited.totalFees = vault.fees;
        deposited.amount += amount;

        // Update the total deposits AFTER accruing fees.
        vault.deposits += amount;

        SafeERC20.safeTransferFrom(_token, msg.sender, address(this), amount);
    }

    function withdraw(uint128 amount) external {
        revert();
    }

    // ------------------------------ Relayer Only -------------------------------------------

    function placeInitialBid(bytes calldata fastTransferVaa, uint64 feeBid) external onlyRelayer {
        // Parse relevant info from the `fastTransferVaa`. The MatchingEngine will verify the
        // wormhole message, we're going to assume that the relayer passed in a valid message.
        TransferInfo memory info = _parseTransferInfo(fastTransferVaa);

        _hasSufficientFunds(_vault, info.amount, info.securityDeposit);

        _matchingEngine.placeInitialBid(fastTransferVaa, feeBid);

        // Update the vault state.
        _recordNewAuction(_vault, info.auctionId, info.amount, info.securityDeposit, feeBid);
    }

    function improveBid(bytes calldata fastTransferVaa, uint64 feeBid) external onlyRelayer {
        TransferInfo memory info = _parseTransferInfo(fastTransferVaa);

        // See if we already participated in the auction.
        Auction storage auction = _auctions[info.auctionId];

        if (auction.amount == 0) {
            _hasSufficientFunds(_vault, info.amount, info.securityDeposit);

            _matchingEngine.improveBid(info.auctionId, feeBid);

            _recordNewAuction(_vault, info.auctionId, info.amount, info.securityDeposit, feeBid);
        } else {
            // If we were outbid, we need to account for new funds being outlayed.
            if (auction.fundsReturned) {
                _hasSufficientFunds(_vault, info.amount, info.securityDeposit);

                _vault.outstanding += info.amount + info.securityDeposit;

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
        Auction storage auction = _auctions[auctionId];

        if (callbackType == Callback.WonAuction) {
            // Update auction state.
            if (additionalFee > 0) {
                auction.auctionFee += additionalFee;
            }
            auction.returnedDeposit = auction.securityDeposit - totalPenalty;
            auction.wonAuction = true;

            // Update the vault state.
            _vault.fees += auction.auctionFee;
            _vault.outstanding -= auction.returnedDeposit;
        } else if (callbackType == Callback.FeeOnly) {
            // We did not win the auction, this is being called because we were
            // awarded the initial auction fee.
            _vault.fees += additionalFee;
        } else if (callbackType == Callback.Outbid) {
            // Auction.
            auction.returnedDeposit = auction.securityDeposit;
            auction.fundsReturned = true;

            // Vault.
            _vault.outstanding -= auction.amount + auction.returnedDeposit;
        } else if (callbackType == Callback.AuctionComplete) {
            // Auction
            auction.returnedDeposit = auction.securityDeposit - totalPenalty;
            auction.fundsReturned = true;

            // Vault.
            _vault.outstanding -= auction.amount + auction.returnedDeposit;
        } else {
            revert ErrInvalidCallbackType();
        }
    }

    // ------------------------------ private -------------------------------------------
    function _calculateAccruedFees(Deposit storage deposited, Vault storage vault)
        private
        view
        returns (uint64)
    {
        if (deposited.totalFees == 0 || deposited.amount == 0) {
            return 0;
        } else {
            return ((vault.fees - deposited.totalFees) * uint64(deposited.amount))
                / uint64(vault.deposits);
        }
    }

    function _hasSufficientFunds(Vault storage vault, uint256 amount, uint128 securityDeposit)
        private
        view
        returns (bool)
    {
        uint256 auctionAmount = uint256(securityDeposit) + amount;
        uint256 maxAvailable = vault.deposits - vault.outstanding;

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

        // Parse the `amountIn` and `maxFee` from the payload.
        (info.amount,) = encoded.asUint128Unchecked(payloadOffset + 1);

        // We can cast to uint64 since this contract will only ever use
        // native USDC which has 6 decimals.
        uint128 securityDeposit;
        (securityDeposit,) = encoded.asUint128Unchecked(payloadOffset + 171);
        info.securityDeposit = uint64(securityDeposit);
    }

    function _recordNewAuction(
        Vault storage vault,
        bytes32 auctionId,
        uint128 transferAmount,
        uint64 securityDeposit,
        uint64 feeBid
    ) private {
        vault.outstanding += transferAmount + securityDeposit;

        // Add the auction to the list of active auctions.
        _auctions[auctionId] = Auction({
            amount: transferAmount,
            auctionFee: feeBid,
            securityDeposit: securityDeposit,
            returnedDeposit: 0,
            wonAuction: false,
            fundsReturned: false
        });
    }
}
