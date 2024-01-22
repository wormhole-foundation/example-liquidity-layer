// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpointState, getFeeRecipientState} from "./Storage.sol";

import {IMatchingEngineAdmin} from "../../interfaces/IMatchingEngineAdmin.sol";

abstract contract MatchingEngineAdmin is IMatchingEngineAdmin, Admin, State {
    /// @inheritdoc IMatchingEngineAdmin
    function addRouterEndpoint(uint16 chain, bytes32 router) external onlyOwnerOrAssistant {
        if (chain == 0) {
            revert ErrChainNotAllowed(chain);
        }

        if (router == bytes32(0)) {
            revert ErrInvalidEndpoint(bytes32(0));
        }

        getRouterEndpointState().endpoints[chain] = router;
    }

    /// @inheritdoc IMatchingEngineAdmin
    function updateFeeRecipient(address newFeeRecipient) external onlyOwnerOrAssistant {
        if (newFeeRecipient == address(0)) {
            revert InvalidAddress();
        }

        getFeeRecipientState().recipient = newFeeRecipient;
    }

    /// @inheritdoc IMatchingEngineAdmin
    function setCctpAllowance(uint256 amount) external onlyOwnerOrAssistant {
        setTokenMessengerApproval(address(_token), amount);
    }
}
