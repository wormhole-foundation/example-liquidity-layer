// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "src/shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpointState, getFeeRecipientState, getCircleDomainsState} from "./Storage.sol";

import {RouterEndpoint} from "src/interfaces/IMatchingEngineTypes.sol";
import {IMatchingEngineAdmin} from "src/interfaces/IMatchingEngineAdmin.sol";

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

        mapping(uint16 chain => RouterEndpoint) storage endpoints =
            getRouterEndpointState().endpoints;

        // When a router is disabled, we set the router universal address to zero, but we will leave
        // the mint recipient alone. So if the mint recipient is non-zero, this indicates that an
        // endpoint was added for this chain ID already.
        //
        // This is also safe because we require that the mint recipient be non-zero when adding and
        // updating endpoints.
        if (endpoints[chain].mintRecipient != bytes32(0)) {
            revert ErrEndpointAlreadyExists(chain);
        }

        endpoints[chain] = endpoint;
        getCircleDomainsState().domains[chain] = circleDomain;
    }

    /// @inheritdoc IMatchingEngineAdmin
    function updateRouterEndpoint(uint16 chain, RouterEndpoint memory endpoint, uint32 circleDomain)
        external
        onlyOwner
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
    function disableRouterEndpoint(uint16 chain) external onlyOwner {
        getRouterEndpointState().endpoints[chain].router = 0;
        getCircleDomainsState().domains[chain] = 0;
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
