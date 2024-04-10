// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity-sdk/libraries/BytesParsing.sol";

import {getOwnerState, getOwnerAssistantState} from "src/shared/Admin.sol";
import {Messages} from "src/shared/Messages.sol";

import {TokenRouterAdmin} from "./assets/TokenRouterAdmin.sol";
import {PlaceMarketOrder} from "./assets/PlaceMarketOrder.sol";
import {RedeemFill} from "./assets/RedeemFill.sol";
import {State} from "./assets/State.sol";
import "./assets/Errors.sol";

contract TokenRouter is TokenRouterAdmin, PlaceMarketOrder, RedeemFill {
    error AlreadyInitialized();

    constructor(
        address token_,
        address wormhole_,
        address cctpTokenMessenger_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineAddress_,
        bytes32 matchingEngineMintRecipient_,
        uint32 matchingEngineDomain_
    )
        State(
            token_,
            wormhole_,
            cctpTokenMessenger_,
            matchingEngineChain_,
            matchingEngineAddress_,
            matchingEngineMintRecipient_,
            matchingEngineDomain_
        )
    {}

    function __TokenRouter_init() internal onlyInitializing {
        if (msg.sender != _deployer) {
            revert ErrCallerNotDeployer(_deployer, msg.sender);
        }
        if (msg.value != 0) {
            revert ErrNonzeroMsgValue();
        }

        getOwnerState().owner = msg.sender;
        getOwnerAssistantState().ownerAssistant = msg.sender;
    }

    function _initialize() internal override {
        __TokenRouter_init();
    }

    function _checkImmutables() internal view override {
        assert(this.orderToken() == _orderToken);
        assert(this.matchingEngineChain() == _matchingEngineChain);
        assert(this.matchingEngineAddress() == _matchingEngineAddress);
        assert(this.matchingEngineMintRecipient() == _matchingEngineMintRecipient);
        assert(this.matchingEngineDomain() == _matchingEngineDomain);
    }

    function _migrate() internal override {}
}
