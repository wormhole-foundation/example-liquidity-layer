// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {
    getRouterEndpointState,
    getFastTransferParametersState,
    getCircleDomainsState,
    FastTransferParameters
} from "./Storage.sol";

import {ITokenRouterAdmin} from "../../interfaces/ITokenRouterAdmin.sol";

abstract contract TokenRouterAdmin is ITokenRouterAdmin, Admin, State {
    /// @inheritdoc ITokenRouterAdmin
    function addRouterEndpoint(uint16 chain, bytes32 router, uint32 circleDomain)
        external
        onlyOwnerOrAssistant
    {
        if (chain == _chainId || chain == 0) {
            revert ErrChainNotAllowed(chain);
        }

        if (router == bytes32(0)) {
            revert ErrInvalidEndpoint(bytes32(0));
        }

        getRouterEndpointState().endpoints[chain] = router;
        getCircleDomainsState().domains[chain] = circleDomain;
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
