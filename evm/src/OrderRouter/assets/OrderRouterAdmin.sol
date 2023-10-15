// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Admin} from "../../shared/Admin.sol";

import "./Errors.sol";
import {SlippageUpdate} from "../../interfaces/Types.sol";
import {State} from "./State.sol";
import {RouterInfo, getRouterInfos, getDefaultRelayerFee} from "./Storage.sol";

abstract contract OrderRouterAdmin is Admin, State {
    function addRouterInfo(uint16 chain, RouterInfo memory info) external onlyOwnerOrAssistant {
        // TODO: don't allow own chain.

        if (info.slippage < MIN_SLIPPAGE) {
            revert ErrRouterSlippageTooLow(info.slippage, MIN_SLIPPAGE);
        }

        if (info.slippage > MAX_SLIPPAGE) {
            revert ErrRouterSlippageTooHigh(info.slippage, MAX_SLIPPAGE);
        }

        getRouterInfos().infos[chain] = info;
    }

    /**
     * @notice Update the slippage for an array of chain and slippage pairs.
     * @dev This function does NOT sanity check the chainId associated with the
     * slippage values. It is the responsibility of the caller to ensure that
     * the chainId is valid. This function also has no upper bound on the
     * number of updates that can be performed in a single transaction. It is
     * the responsibility of the caller to ensure that the transaction does not
     * exceed the block gas limit.
     */
    function updateSlippage(SlippageUpdate[] calldata update) external onlyOwnerOrAssistant {
        uint256 len = update.length;
        if (len == 0) {
            revert ErrNoSlippageUpdate();
        }

        for (uint256 i = 0; i < len; ) {
            uint24 slippage = update[i].slippage;

            if (slippage < MIN_SLIPPAGE) {
                revert ErrRouterSlippageTooLow(slippage, MIN_SLIPPAGE);
            }

            if (slippage > MAX_SLIPPAGE) {
                revert ErrRouterSlippageTooHigh(slippage, MAX_SLIPPAGE);
            }

            // Update the slippage.
            getRouterInfos().infos[update[i].chain].slippage = slippage;

            unchecked {
                ++i;
            }
        }
    }

    function updateDefaultRelayerFee(uint256 fee) external onlyOwnerOrAssistant {
        getDefaultRelayerFee().fee = fee;
    }
}
