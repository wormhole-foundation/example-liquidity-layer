// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {denormalizeAmount, getDecimals, toUniversalAddress} from "../../shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";

import "../../interfaces/IRedeemFill.sol";
import {RouterInfo, TokenType, OrderResponse} from "../../interfaces/Types.sol";

import "forge-std/console.sol";

abstract contract RedeemFill is IRedeemFill, Admin, State {
    using Messages for *;

    function redeemFill(OrderResponse calldata response) external returns (RedeemedFill memory) {
        if (response.circleBridgeMessage.length == 0 && response.circleAttestation.length == 0) {
            ITokenBridge.TransferWithPayload memory transfer = _tokenBridge
                .parseTransferWithPayload(
                    _tokenBridge.completeTransferWithPayload(response.encodedWormholeMessage)
                );

            return
                _processFill(
                    response.encodedWormholeMessage,
                    TokenType.Canonical,
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
                _processFill(
                    response.encodedWormholeMessage,
                    TokenType.Cctp,
                    deposit.fromAddress,
                    deposit.amount,
                    deposit.payload
                );
        }
    }

    function _processFill(
        bytes memory encodedVaa,
        TokenType directFillTokenType,
        bytes32 fromAddress,
        uint256 amount,
        bytes memory payload
    ) private returns (RedeemedFill memory) {
        uint16 emitterChain = encodedVaa.unsafeEmitterChainFromVaa();

        // Parse the fill. We need to check the sender chain to see if it came from a known router.
        Messages.Fill memory fill = payload.decodeFill();
        RouterInfo memory src = getRouterInfo(fill.sourceChain);

        // If the matching engine sent this fill, we bypass this whole conditional.
        if (fromAddress != _matchingEngineEndpoint) {
            // The case where the order router's token type is the direct fill type, then we need to
            // make sure the source is what we expect from our known order routers.
            if (_tokenType == directFillTokenType || _wormholeChainId == _canonicalTokenChain) {
                if (
                    emitterChain != fill.sourceChain ||
                    (src.tokenType != directFillTokenType &&
                        emitterChain != _canonicalTokenChain) ||
                    fromAddress != src.endpoint
                ) {
                    revert ErrInvalidSourceRouter(emitterChain, src.tokenType, fromAddress);
                }
            } else {
                // Otherwise, this VAA is not for us.
                revert ErrSourceNotMatchingEngine(emitterChain, fromAddress);
            }
        } else if (emitterChain != _matchingEngineChain) {
            revert ErrSourceNotMatchingEngine(emitterChain, fromAddress);
        }

        // Make sure the redeemer is who we expect.
        if (toUniversalAddress(msg.sender) != fill.redeemer) {
            revert ErrInvalidRedeemer(toUniversalAddress(msg.sender), fill.redeemer);
        }

        // Transfer token amount to redeemer.
        SafeERC20.safeTransfer(_orderToken, msg.sender, amount);

        return
            RedeemedFill({
                sender: fill.orderSender,
                senderChain: fill.sourceChain,
                token: address(_orderToken),
                amount: amount,
                message: fill.redeemerMessage
            });
    }
}
