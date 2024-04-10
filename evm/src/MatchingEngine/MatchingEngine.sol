// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity-sdk/libraries/BytesParsing.sol";

import {getOwnerState, getOwnerAssistantState} from "src/shared/Admin.sol";

import {getFeeRecipientState} from "./assets/Storage.sol";
import {MatchingEngineAdmin} from "./assets/MatchingEngineAdmin.sol";
import {MatchingEngineFastOrders} from "./assets/MatchingEngineFastOrders.sol";
import {State} from "./assets/State.sol";
import "./assets/Errors.sol";

contract MatchingEngine is MatchingEngineFastOrders, MatchingEngineAdmin {
    error AlreadyInitialized();

    constructor(
        address cctpToken_,
        address wormhole_,
        address cctpTokenMessenger_,
        uint24 userPenaltyRewardBps_,
        uint24 initialPenaltyBps_,
        uint8 auctionDuration_,
        uint8 auctionGracePeriod_,
        uint8 auctionPenaltyBlocks_
    )
        State(
            cctpToken_,
            wormhole_,
            cctpTokenMessenger_,
            userPenaltyRewardBps_,
            initialPenaltyBps_,
            auctionDuration_,
            auctionGracePeriod_,
            auctionPenaltyBlocks_
        )
    {}

    function __MatchingEngine_init() internal onlyInitializing {
        if (msg.sender != _deployer) {
            revert ErrCallerNotDeployer(_deployer, msg.sender);
        }
        if (msg.value != 0) {
            revert ErrNonzeroMsgValue();
        }

        getOwnerState().owner = msg.sender;
        getOwnerAssistantState().ownerAssistant = msg.sender;
        getFeeRecipientState().recipient = msg.sender;
    }

    function _initialize() internal override {
        __MatchingEngine_init();
    }

    function _checkImmutables() internal view override {
        assert(this.token() == _token);
        assert(this.getUserPenaltyRewardBps() == _userPenaltyRewardBps);
        assert(this.getInitialPenaltyBps() == _initialPenaltyBps);
        assert(this.getAuctionDuration() == _auctionDuration);
        assert(this.getAuctionGracePeriod() == _auctionGracePeriod);
        assert(this.getAuctionPenaltyBlocks() == _auctionPenaltyBlocks);
    }

    function _migrate() internal override {}
}
