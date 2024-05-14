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
    using BytesParsing for bytes;

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

    function __MatchingEngine_init(bytes memory initData) internal onlyInitializing {
        if (msg.sender != _deployer) {
            revert ErrCallerNotDeployer(_deployer, msg.sender);
        }

        // Decode the init data, verify that the addresses are not the zero address.
        (address ownerAssistant, address feeRecipient) = _parseInitData(initData);

        if (ownerAssistant == address(0) || feeRecipient == address(0)) {
            revert InvalidAddress();
        }

        getOwnerState().owner = msg.sender;
        getOwnerAssistantState().ownerAssistant = ownerAssistant;
        getFeeRecipientState().recipient = feeRecipient;
    }

    function _initialize(bytes memory initData) internal override {
        __MatchingEngine_init(initData);
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

    function _parseInitData(bytes memory initData)
        internal
        pure
        returns (address ownerAssistant, address feeRecipient)
    {
        uint256 offset = 0;

        (ownerAssistant, offset) = initData.asAddressUnchecked(offset);
        (feeRecipient, offset) = initData.asAddressUnchecked(offset);

        initData.checkLength(offset);
    }
}
