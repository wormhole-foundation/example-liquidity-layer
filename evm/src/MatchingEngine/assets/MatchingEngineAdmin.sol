// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpointState, getFeeRecipientState, getCircleDomainsState} from "./Storage.sol";

import {RouterEndpoint} from "../../interfaces/IMatchingEngineTypes.sol";
import {IMatchingEngineAdmin} from "../../interfaces/IMatchingEngineAdmin.sol";

abstract contract MatchingEngineAdmin is IMatchingEngineAdmin, Admin, State {
    /// @inheritdoc IMatchingEngineAdmin
    function addRouterEndpoint(uint16 chain, RouterEndpoint memory endpoint, uint32 circleDomain)
        external
        onlyOwnerOrAssistant
    {
        if (chain == 0) {
            revert ErrChainNotAllowed(chain);
        }

        if (endpoint.router == bytes32(0) || endpoint.mintRecipient == bytes32(0)) {
            revert ErrInvalidEndpoint(bytes32(0));
        }

        getRouterEndpointState().endpoints[chain] = endpoint;
        getCircleDomainsState().domains[chain] = circleDomain;
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
