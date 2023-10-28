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

abstract contract RedeemFill is IRedeemFill, Admin, State {
    using Messages for *;

    function redeemFill(OrderResponse calldata response) external returns (RedeemedFill memory) {
        ICircleIntegration.DepositWithPayload memory deposit = _wormholeCctp
            .redeemTokensWithPayload(
                ICircleIntegration.RedeemParameters({
                    encodedWormholeMessage: response.encodedWormholeMessage,
                    circleBridgeMessage: response.circleBridgeMessage,
                    circleAttestation: response.circleAttestation
                })
            );

        Messages.Fill memory fill = deposit.payload.decodeFill();

        bytes32 fromRouter = getRouter(response.encodedWormholeMessage.unsafeEmitterChainFromVaa());
        if (deposit.fromAddress != fromRouter) {
            revert ErrInvalidSourceRouter(deposit.fromAddress, fromRouter);
        }

        // Make sure the redeemer is who we expect.
        bytes32 redeemer = toUniversalAddress(msg.sender);
        if (redeemer != fill.redeemer) {
            revert ErrInvalidRedeemer(redeemer, fill.redeemer);
        }

        // Transfer token amount to redeemer.
        SafeERC20.safeTransfer(_orderToken, msg.sender, deposit.amount);

        return RedeemedFill({
            sender: fill.orderSender,
            senderChain: fill.sourceChain,
            token: address(_orderToken),
            amount: deposit.amount,
            message: fill.redeemerMessage
        });
    }
}
