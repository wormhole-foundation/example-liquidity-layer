// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {RouterInfo, getRouterInfos} from "./Storage.sol";

abstract contract OrderRouterAdmin is Admin, State {
    function addRouterInfo(uint16 chain, RouterInfo memory info) external onlyOwnerOrAssistant {
        if (info.slippage < MIN_SLIPPAGE) {
            revert ErrRouterSlippageTooLow(info.slippage, MIN_SLIPPAGE);
        }

        if (info.slippage > MAX_SLIPPAGE) {
            revert ErrRouterSlippageTooHigh(info.slippage, MAX_SLIPPAGE);
        }

        getRouterInfos().infos[chain] = info;
    }

    // TODO: add a way to update slippage in batch
}
