// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {toUniversalAddress} from "../../shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";

import "../../interfaces/IRedeemOrderRevert.sol";
import {RouterInfo, TokenType} from "../../interfaces/Types.sol";

abstract contract RedeemOrderRevert is IRedeemOrderRevert, Admin, State {
    using Messages for *;

    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine.
     */
    function redeemOrderRevert(bytes calldata encodedVaa) external returns (Messages.RevertType) {
        ITokenBridge.TransferWithPayload memory transfer = _tokenBridge.parseTransferWithPayload(
            _tokenBridge.completeTransferWithPayload(encodedVaa)
        );

        return
            _processOrderRevert(
                encodedVaa,
                transfer.fromAddress,
                transfer.amount,
                transfer.payload
            );
    }

    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine via CCTP.
     */
    function redeemOrderRevert(
        ICircleIntegration.RedeemParameters calldata redeemParams
    ) external returns (Messages.RevertType) {
        ICircleIntegration.DepositWithPayload memory deposit = _wormholeCctp
            .redeemTokensWithPayload(redeemParams);

        return
            _processOrderRevert(
                redeemParams.encodedWormholeMessage,
                deposit.fromAddress,
                deposit.amount,
                deposit.payload
            );
    }

    function _processOrderRevert(
        bytes memory encodedVaa,
        bytes32 fromAddress,
        uint256 amount,
        bytes memory payload
    ) internal returns (Messages.RevertType) {
        uint16 emitterChain = encodedVaa.unsafeEmitterChainFromVaa();
        if (emitterChain != _matchingEngineChain || fromAddress != _matchingEngineEndpoint) {
            revert ErrSourceNotMatchingEngine(emitterChain, fromAddress);
        }

        // Parse the fill. We need to check the sender chain to see if it came from a known router.
        Messages.OrderRevert memory orderRevert = payload.decodeOrderRevert();

        // Make sure the redeemer is who we expect.
        if (toUniversalAddress(msg.sender) != orderRevert.refundAddress) {
            revert ErrInvalidRedeemer(toUniversalAddress(msg.sender), orderRevert.refundAddress);
        }

        // Transfer token amount to redeemer.
        SafeERC20.safeTransfer(_orderToken, msg.sender, amount);

        return orderRevert.reason;
    }
}
