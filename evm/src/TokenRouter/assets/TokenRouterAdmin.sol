// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "src/shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {
    getRouterEndpointState,
    getFastTransferParametersState,
    getCircleDomainsState,
    FastTransferParameters
} from "./Storage.sol";

import {Endpoint} from "src/interfaces/ITokenRouterTypes.sol";
import {ITokenRouterAdmin} from "src/interfaces/ITokenRouterAdmin.sol";

abstract contract TokenRouterAdmin is ITokenRouterAdmin, Admin, State {
    /// @inheritdoc ITokenRouterAdmin
    function addRouterEndpoint(uint16 chain, Endpoint memory endpoint, uint32 circleDomain)
        external
        onlyOwnerOrAssistant
    {
        if (chain == _chainId || chain == 0) {
            revert ErrChainNotAllowed(chain);
        }

        if (endpoint.router == bytes32(0) || endpoint.mintRecipient == bytes32(0)) {
            revert ErrInvalidEndpoint(bytes32(0));
        }

        mapping(uint16 chain => Endpoint) storage endpoints = getRouterEndpointState().endpoints;

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

    /// @inheritdoc ITokenRouterAdmin
    function updateRouterEndpoint(uint16 chain, Endpoint memory endpoint, uint32 circleDomain)
        external
        onlyOwner
    {
        if (chain == _chainId || chain == 0) {
            revert ErrChainNotAllowed(chain);
        }

        if (endpoint.router == bytes32(0) || endpoint.mintRecipient == bytes32(0)) {
            revert ErrInvalidEndpoint(bytes32(0));
        }

        getRouterEndpointState().endpoints[chain] = endpoint;
        getCircleDomainsState().domains[chain] = circleDomain;
    }

    /// @inheritdoc ITokenRouterAdmin
    function disableRouterEndpoint(uint16 chain) external onlyOwner {
        getRouterEndpointState().endpoints[chain].router = 0;
        getCircleDomainsState().domains[chain] = 0;
    }

    /// @inheritdoc ITokenRouterAdmin
    function updateFastTransferParameters(FastTransferParameters memory newParams)
        external
        onlyOwnerOrAssistant
    {
        FastTransferParameters storage params = getFastTransferParametersState();

        if (newParams.maxAmount <= newParams.baseFee + newParams.initAuctionFee) {
            revert ErrInvalidFastTransferParameters();
        }

        params.enabled = newParams.enabled;
        params.baseFee = newParams.baseFee;
        params.maxAmount = newParams.maxAmount;
        params.initAuctionFee = newParams.initAuctionFee;
    }

    /// @inheritdoc ITokenRouterAdmin
    function enableFastTransfers(bool enable) external onlyOwnerOrAssistant {
        getFastTransferParametersState().enabled = enable;
    }

    /// @inheritdoc ITokenRouterAdmin
    function setCctpAllowance(uint256 amount) external onlyOwnerOrAssistant {
        setTokenMessengerApproval(address(_orderToken), amount);
    }
}
