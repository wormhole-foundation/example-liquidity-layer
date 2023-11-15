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
    getAuctionConfig
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

    constructor(address wormholeCctp_, address cctpToken_) {
        assert(wormholeCctp_ != address(0));
        assert(cctpToken_ != address(0));

        _deployer = msg.sender;
        _wormholeCctp = ICircleIntegration(wormholeCctp_);
        _wormholeChainId = _wormholeCctp.chainId();
        _wormhole = _wormholeCctp.wormhole();
        _token = IERC20(cctpToken_);
    }

    /// @inheritdoc IMatchingEngineState
    function getDeployer() external view returns (address) {
        return _deployer;
    }

    /// @inheritdoc IMatchingEngineState
    function getRouter(uint16 chain) public view returns (bytes32) {
        return getRouterEndpointState().endpoints[chain];
    }

    function maxBpsFee() public pure returns (uint24) {
        return MAX_BPS_FEE;
    }

    function getAuctionDuration() public view returns (uint8) {
        return getAuctionConfig().auctionDuration;
    }

    function getAuctionGracePeriod() public view returns (uint8) {
        return getAuctionConfig().auctionGracePeriod;
    }

    function getAuctionPenaltyBlocks() public view returns (uint8) {
        return getAuctionConfig().penaltyBlocks;
    }

    function auctionConfig() public pure returns (AuctionConfig memory) {
        return getAuctionConfig();
    }

    function getAuctionStatus(bytes32 auctionId) public view returns (AuctionStatus) {
        return getLiveAuctionInfo().auctions[auctionId].status;
    }

    function liveAuctionInfo(bytes32 auctionId) public view returns (LiveAuctionData memory) {
        return getLiveAuctionInfo().auctions[auctionId];
    }
}
