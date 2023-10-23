// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {denormalizeAmount, fromUniversalAddress, getDecimals, toUniversalAddress} from "../../shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";

import "../../interfaces/IRedeemOrderRevert.sol";
import {RevertType, RouterInfo, TokenType, OrderResponse} from "../../interfaces/Types.sol";

abstract contract RedeemOrderRevert is IRedeemOrderRevert, Admin, State {
    using Messages for *;

    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine.
     */
    function redeemOrderRevert(
        OrderResponse memory response
    ) external returns (RevertType, address) {
        if (response.circleBridgeMessage.length == 0 && response.circleAttestation.length == 0) {
            ITokenBridge.TransferWithPayload memory transfer = _tokenBridge
                .parseTransferWithPayload(
                    _tokenBridge.completeTransferWithPayload(response.encodedWormholeMessage)
                );

            return
                _processOrderRevert(
                    response.encodedWormholeMessage,
                    transfer.fromAddress,
                    denormalizeAmount(transfer.amount, getDecimals(address(_orderToken))),
                    transfer.payload
                );
        } else {
            ICircleIntegration.DepositWithPayload memory deposit = _wormholeCctp
                .redeemTokensWithPayload(
                    ICircleIntegration.RedeemParameters({
                        encodedWormholeMessage: response.encodedWormholeMessage,
                        circleBridgeMessage: response.circleBridgeMessage,
                        circleAttestation: response.circleAttestation
                    })
                );

            return
                _processOrderRevert(
                    response.encodedWormholeMessage,
                    deposit.fromAddress,
                    deposit.amount,
                    deposit.payload
                );
        }
    }

    function _processOrderRevert(
        bytes memory encodedVaa,
        bytes32 fromAddress,
        uint256 amount,
        bytes memory payload
    ) private returns (RevertType, address) {
        uint16 emitterChain = encodedVaa.unsafeEmitterChainFromVaa();
        if (emitterChain != _matchingEngineChain || fromAddress != _matchingEngineEndpoint) {
            revert ErrSourceNotMatchingEngine(emitterChain, fromAddress);
        }

        // Parse the fill. We need to check the sender chain to see if it came from a known router.
        Messages.OrderRevert memory orderRevert = payload.decodeOrderRevert();

        // Make sure the redeemer is who we expect.
        if (toUniversalAddress(msg.sender) != orderRevert.redeemer) {
            revert ErrInvalidRedeemer(toUniversalAddress(msg.sender), orderRevert.redeemer);
        }

        // Transfer token amount to redeemer.
        SafeERC20.safeTransfer(_orderToken, msg.sender, amount);

        return (orderRevert.reason, fromUniversalAddress(orderRevert.refundAddress));
    }
}
