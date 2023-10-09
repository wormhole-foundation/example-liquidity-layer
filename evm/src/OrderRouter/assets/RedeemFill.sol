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

import "../../interfaces/IRedeemFill.sol";
import {RouterInfo, TokenType} from "../../interfaces/Types.sol";

abstract contract RedeemFill is IRedeemFill, Admin, State {
    using Messages for *;

    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine.
     */
    function redeemFill(bytes calldata encodedVaa) external returns (RedeemedFill memory) {
        ITokenBridge.TransferWithPayload memory transfer = tokenBridge.parseTransferWithPayload(
            tokenBridge.completeTransferWithPayload(encodedVaa)
        );

        return
            _processFill(
                encodedVaa,
                TokenType.Canonical,
                transfer.fromAddress,
                transfer.amount,
                transfer.payload
            );
    }

    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine via CCTP.
     */
    function redeemFill(
        ICircleIntegration.RedeemParameters calldata redeemParams
    ) external returns (RedeemedFill memory) {
        ICircleIntegration.DepositWithPayload memory deposit = wormholeCctp.redeemTokensWithPayload(
            redeemParams
        );

        return
            _processFill(
                redeemParams.encodedWormholeMessage,
                TokenType.Cctp,
                deposit.fromAddress,
                deposit.amount,
                deposit.payload
            );
    }

    function _processFill(
        bytes memory encodedVaa,
        TokenType directFillTokenType,
        bytes32 fromAddress,
        uint256 amount,
        bytes memory payload
    ) internal returns (RedeemedFill memory) {
        uint16 emitterChain = encodedVaa.unsafeEmitterChainFromVaa();

        // Parse the fill. We need to check the sender chain to see if it came from a known router.
        Messages.Fill memory fill = payload.decodeFill();
        RouterInfo memory src = this.getRouterInfo(fill.sourceChain);

        // If the matching engine sent this fill, we bypass this whole conditional.
        if (fromAddress != matchingEngineEndpoint) {
            // The case where the order router's token type is the direct fill type, then we need to
            // make sure the source is what we expect from our known order routers.
            if (tokenType == directFillTokenType) {
                if (
                    emitterChain != fill.sourceChain ||
                    src.tokenType != directFillTokenType ||
                    fromAddress != src.endpoint
                ) {
                    revert ErrInvalidSourceRouter(emitterChain, src.tokenType, fromAddress);
                }
            } else {
                // Otherwise, this VAA is not for us.
                revert ErrSourceNotMatchingEngine(emitterChain, fromAddress);
            }
        } else if (emitterChain != matchingEngineChain) {
            revert ErrSourceNotMatchingEngine(emitterChain, fromAddress);
        }

        // Make sure the redeemer is who we expect.
        if (toUniversalAddress(msg.sender) != fill.redeemer) {
            revert ErrInvalidRedeemer(toUniversalAddress(msg.sender), fill.redeemer);
        }

        // Transfer token amount to redeemer.
        SafeERC20.safeTransfer(orderToken, msg.sender, amount);

        return
            RedeemedFill({
                sender: fill.orderSender,
                senderChain: fill.sourceChain,
                token: address(orderToken),
                amount: amount,
                message: fill.redeemerMessage
            });
    }
}
