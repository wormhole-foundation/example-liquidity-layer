// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {IMatchingEngineState} from "../../interfaces/IMatchingEngineState.sol";

import "./Errors.sol";

import {
    getRouterEndpointState,
    getLiveAuctionInfo,
    LiveAuctionData,
    AuctionStatus,
    AuctionConfig,
    getAuctionConfig,
    getFastFillsState,
    getFeeRecipientState
} from "./Storage.sol";

abstract contract State is IMatchingEngineState {
    // Immutable state.
    address immutable _deployer;
    uint16 immutable _wormholeChainId;
    IWormhole immutable _wormhole;
    ICircleIntegration immutable _wormholeCctp;
    IERC20 immutable _token;

    // Consts.
    uint8 constant FINALITY = 1;
    uint32 constant NONCE = 0;
    uint24 constant MAX_BPS_FEE = 1000000; // 10,000.00 bps (100%)

    constructor(address cctpToken_, address wormholeCctp_) {
        assert(cctpToken_ != address(0));
        assert(wormholeCctp_ != address(0));

        _deployer = msg.sender;
        _wormholeCctp = ICircleIntegration(wormholeCctp_);
        _wormholeChainId = _wormholeCctp.chainId();
        _wormhole = _wormholeCctp.wormhole();
        _token = IERC20(cctpToken_);
    }

    /// @inheritdoc IMatchingEngineState
    function calculateDynamicPenalty(uint256 amount, uint256 blocksElapsed)
        external
        pure
        returns (uint256 penalty, uint256 userReward)
    {
        return calculateDynamicPenalty(getAuctionConfig(), amount, blocksElapsed);
    }

    /// @inheritdoc IMatchingEngineState
    function calculateDynamicPenalty(bytes32 auctionId)
        external
        view
        returns (uint256 penalty, uint256 userReward)
    {
        LiveAuctionData memory auction = getLiveAuctionInfo().auctions[auctionId];
        return calculateDynamicPenalty(
            getAuctionConfig(), auction.securityDeposit, uint88(block.number) - auction.startBlock
        );
    }

    /// @inheritdoc IMatchingEngineState
    function calculateDynamicPenalty(
        AuctionConfig memory config,
        uint256 amount,
        uint256 blocksElapsed
    ) public pure returns (uint256, uint256) {
        if (blocksElapsed <= config.auctionGracePeriod) {
            return (0, 0);
        }

        uint256 penaltyPeriod = blocksElapsed - config.auctionGracePeriod;
        if (penaltyPeriod > config.penaltyBlocks || config.initialPenaltyBps == MAX_BPS_FEE) {
            uint256 userReward = amount * config.userPenaltyRewardBps / MAX_BPS_FEE;
            return (amount - userReward, userReward);
        }

        uint256 basePenalty = amount * config.initialPenaltyBps / MAX_BPS_FEE;
        uint256 penalty =
            basePenalty + ((amount - basePenalty) * penaltyPeriod / config.penaltyBlocks);
        uint256 userReward = penalty * config.userPenaltyRewardBps / MAX_BPS_FEE;

        return (penalty - userReward, userReward);
    }

    /// @inheritdoc IMatchingEngineState
    function getDeployer() external view returns (address) {
        return _deployer;
    }

    /// @inheritdoc IMatchingEngineState
    function getRouter(uint16 chain) public view returns (bytes32) {
        return getRouterEndpointState().endpoints[chain];
    }

    /// @inheritdoc IMatchingEngineState
    function wormholeCctp() external view returns (ICircleIntegration) {
        return _wormholeCctp;
    }

    /// @inheritdoc IMatchingEngineState
    function wormhole() external view returns (IWormhole) {
        return _wormhole;
    }

    /// @inheritdoc IMatchingEngineState
    function wormholeChainId() external view returns (uint16) {
        return _wormholeChainId;
    }

    /// @inheritdoc IMatchingEngineState
    function feeRecipient() public view returns (address) {
        return getFeeRecipientState().recipient;
    }

    /// @inheritdoc IMatchingEngineState
    function token() external view returns (IERC20) {
        return _token;
    }

    /// @inheritdoc IMatchingEngineState
    function maxBpsFee() public pure returns (uint24) {
        return MAX_BPS_FEE;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionDuration() public view returns (uint8) {
        return getAuctionConfig().auctionDuration;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionGracePeriod() public view returns (uint8) {
        return getAuctionConfig().auctionGracePeriod;
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionPenaltyBlocks() public view returns (uint8) {
        return getAuctionConfig().penaltyBlocks;
    }

    /// @inheritdoc IMatchingEngineState
    function auctionConfig() public pure returns (AuctionConfig memory) {
        return getAuctionConfig();
    }

    /// @inheritdoc IMatchingEngineState
    function getAuctionBlocksElapsed(bytes32 auctionId) public view returns (uint256) {
        return block.number - getLiveAuctionInfo().auctions[auctionId].startBlock;
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
    function isFastFillRedeemed(bytes32 vaaHash) public view returns (bool) {
        return getFastFillsState().redeemed[vaaHash];
    }
}
