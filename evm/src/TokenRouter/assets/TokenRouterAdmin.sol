// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpointState, getFastTransferParametersState, FastTransferParameters} from "./Storage.sol";

import {ITokenRouterAdmin} from "../../interfaces/ITokenRouterAdmin.sol";

abstract contract TokenRouterAdmin is ITokenRouterAdmin, Admin, State {
    /// @inheritdoc ITokenRouterAdmin
    function addRouterEndpoint(uint16 chain, bytes32 router) external onlyOwnerOrAssistant {
        if (chain == _wormholeChainId) {
            revert ErrChainNotAllowed(chain);
        }

        if (chain == 0) {
            revert ErrChainNotAllowed(chain);
        }

        if (router == bytes32(0)) {
            revert ErrInvalidEndpoint(bytes32(0));
        }

        getRouterEndpointState().endpoints[chain] = router;
    }

    function updateFastTransferParameters(
        FastTransferParameters memory newParams
    ) external onlyOwnerOrAssistant {
        FastTransferParameters storage params = getFastTransferParametersState();

        if (newParams.feeInBps > MAX_BPS_FEE || newParams.feeInBps == 0) {
            revert ErrInvalidFeeInBps();
        }

        params.feeInBps = newParams.feeInBps;
        params.baseFee = newParams.baseFee;
        params.maxAmount = newParams.maxAmount;
    }

    function disableFastTransfers() external onlyOwnerOrAssistant {
        getFastTransferParametersState().feeInBps = 0;
    }
}
