// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWormhole} from "wormhole-solidity-sdk/interfaces/IWormhole.sol";
import {IMatchingEngineState} from "src/interfaces/IMatchingEngineState.sol";
import {RouterEndpoint} from "src/interfaces/IMatchingEngineTypes.sol";

import "./Errors.sol";
import {
    getRouterEndpointState,
    getLiveAuctionInfo,
    LiveAuctionData,
    AuctionStatus,
    getFastFillsState,
    getFeeRecipientState,
    getCircleDomainsState
} from "./Storage.sol";

import {WormholeCctpTokenMessenger} from "src/shared/WormholeCctpTokenMessenger.sol";

abstract contract State is IMatchingEngineState, WormholeCctpTokenMessenger {
    // ------------------------------ Constants -------------------------------------------
    uint8 constant FINALITY = 1;
    uint32 constant NONCE = 0;
    uint24 constant MAX_BPS_FEE = 1000000; // 100%

    // ------------------------------ Immutable State -------------------------------------
    address immutable _deployer;
    IERC20 immutable _token;

    // ------------------------------ Auction Parameters ----------------------------------
    // The percentage of the penalty that is awarded to the user when the auction is completed.
    uint24 immutable _userPenaltyRewardBps;
    // The initial penalty percentage that is incurred once the grace period is over.
    uint24 immutable _initialPenaltyBps;
    // The duration of the auction in blocks. About 6 seconds on Avalanche.
    uint8 immutable _auctionDuration;
    /**
     * The grace period of the auction in blocks. This is the number of blocks the highest bidder
     * has to execute the fast order before incurring a penalty. About 15 seconds on Avalanche.
     * This value INCLUDES the `_auctionDuration`.
     */
    uint8 immutable _auctionGracePeriod;
    // The `securityDeposit` decays over the `penaltyBlocks` blocks period.
    uint8 immutable _auctionPenaltyBlocks;

    constructor(
        address cctpToken_,
        address wormhole_,
        address cctpTokenMessenger_,
        uint24 userPenaltyRewardBps_,
        uint24 initialPenaltyBps_,
        uint8 auctionDuration_,
        uint8 auctionGracePeriod_,
        uint8 auctionPenaltyBlocks_
    ) WormholeCctpTokenMessenger(wormhole_, cctpTokenMessenger_) {
        assert(cctpToken_ != address(0));

        _deployer = msg.sender;
        _token = IERC20(cctpToken_);

        // Set the auction parameters, after validating them.
        if (auctionDuration_ == 0) {
            revert ErrInvalidAuctionDuration();
        }
        if (auctionGracePeriod_ <= auctionDuration_) {
            revert ErrInvalidAuctionGracePeriod();
        }
        if (userPenaltyRewardBps_ > MAX_BPS_FEE) {
            revert ErrInvalidUserPenaltyRewardBps();
        }
        if (initialPenaltyBps_ > MAX_BPS_FEE) {
            revert ErrInvalidInitialPenaltyBps();
        }

        _userPenaltyRewardBps = userPenaltyRewardBps_;
        _initialPenaltyBps = initialPenaltyBps_;
        _auctionDuration = auctionDuration_;
        _auctionGracePeriod = auctionGracePeriod_;
        _auctionPenaltyBlocks = auctionPenaltyBlocks_;
    }

    /// @inheritdoc IMatchingEngineState
    function calculateDynamicPenalty(bytes32 auctionId)
        external
        view
        returns (uint64 penalty, uint64 userReward)
    {
        LiveAuctionData memory auction = getLiveAuctionInfo().auctions[auctionId];
        return calculateDynamicPenalty(
            auction.securityDeposit, uint64(block.number) - auction.startBlock
        );
    }

    /// @inheritdoc IMatchingEngineState
    function calculateDynamicPenalty(uint64 amount, uint64 blocksElapsed)
        public
        view
        returns (uint64, uint64)
    {
        if (blocksElapsed <= _auctionGracePeriod) {
            return (0, 0);
        }

        uint64 penaltyPeriod = blocksElapsed - _auctionGracePeriod;
        if (penaltyPeriod >= _auctionPenaltyBlocks || _initialPenaltyBps == MAX_BPS_FEE) {
            uint64 userReward = amount * _userPenaltyRewardBps / MAX_BPS_FEE;
            return (amount - userReward, userReward);
        } else {
            uint64 basePenalty = amount * _initialPenaltyBps / MAX_BPS_FEE;
            uint64 penalty =
                basePenalty + ((amount - basePenalty) * penaltyPeriod / _auctionPenaltyBlocks);
            uint64 userReward = penalty * _userPenaltyRewardBps / MAX_BPS_FEE;

            return (penalty - userReward, userReward);
        }
    }

    /// @inheritdoc IMatchingEngineState
    function getDeployer() public view returns (address) {
        return _deployer;
    }

    /// @inheritdoc IMatchingEngineState
    function getRouter(uint16 chain) public view returns (bytes32) {
        return getRouterEndpointState().endpoints[chain].router;
    }

    /// @inheritdoc IMatchingEngineState
    function getMintRecipient(uint16 chain) public view returns (bytes32) {
        return getRouterEndpointState().endpoints[chain].mintRecipient;
    }

    /// @inheritdoc IMatchingEngineState
    function getRouterEndpoint(uint16 chain) public view returns (RouterEndpoint memory) {
        return getRouterEndpointState().endpoints[chain];
    }

    /// @inheritdoc IMatchingEngineState
    function getDomain(uint16 chain) public view returns (uint32) {
        return getCircleDomainsState().domains[chain];
    }

    /// @inheritdoc IMatchingEngineState
    function wormhole() public view returns (IWormhole) {
        return _wormhole;
    }

    /// @inheritdoc IMatchingEngineState
    function wormholeChainId() public view returns (uint16) {
        return _chainId;
    }

    /// @inheritdoc IMatchingEngineState
    function feeRecipient() public view returns (address) {
        return getFeeRecipientState().recipient;
    }

    /// @inheritdoc IMatchingEngineState
    function token() public view returns (IERC20) {
        return _token;
    }

    /// @inheritdoc IMatchingEngineState
    function maxBpsFee() public pure returns (uint24) {
        return MAX_BPS_FEE;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionDuration() public view returns (uint8) {
        return _auctionDuration;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionGracePeriod() public view returns (uint8) {
        return _auctionGracePeriod;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionPenaltyBlocks() public view returns (uint8) {
        return _auctionPenaltyBlocks;
    }

    function getUserPenaltyRewardBps() public view returns (uint24) {
        return _userPenaltyRewardBps;
    }

    function getInitialPenaltyBps() public view returns (uint24) {
        return _initialPenaltyBps;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionBlocksElapsed(bytes32 auctionId) public view returns (uint64) {
        return uint64(block.number) - getLiveAuctionInfo().auctions[auctionId].startBlock;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionStatus(bytes32 auctionId) public view returns (AuctionStatus) {
        return getLiveAuctionInfo().auctions[auctionId].status;
    }

    /// @inheritdoc IMatchingEngineState
    function liveAuctionInfo(bytes32 auctionId) public view returns (LiveAuctionData memory) {
        return getLiveAuctionInfo().auctions[auctionId];
    }

    /// @inheritdoc IMatchingEngineState
    function getHighestBidder(bytes32 auctionId) public view returns (address) {
        return getLiveAuctionInfo().auctions[auctionId].highestBidder;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionAmount(bytes32 auctionId) public view returns (uint64) {
        return getLiveAuctionInfo().auctions[auctionId].amount;
    }

    /// @inheritdoc IMatchingEngineState
    function getSecurityDeposit(bytes32 auctionId) public view returns (uint64) {
        return getLiveAuctionInfo().auctions[auctionId].securityDeposit;
    }

    /// @inheritdoc IMatchingEngineState
    function isFastFillRedeemed(bytes32 vaaHash) public view returns (bool) {
        return getFastFillsState().redeemed[vaaHash];
    }
}
