// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpoint} from "./Storage.sol";

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

        getRouterEndpoint().endpoints[chain] = router;
    }
}
