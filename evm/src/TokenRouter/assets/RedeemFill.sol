// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";

import {IMatchingEngine} from "../../interfaces/IMatchingEngine.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {fromUniversalAddress} from "../../shared/Utils.sol";
import {toUniversalAddress} from "../../shared/Utils.sol";

import "./Errors.sol";
import {State} from "./State.sol";

import "../../interfaces/IRedeemFill.sol";

import "forge-std/console.sol";

abstract contract RedeemFill is IRedeemFill, Admin, State {
    using Messages for *;

    /// @inheritdoc IRedeemFill
    function redeemFill(OrderResponse calldata response) external returns (RedeemedFill memory) {
        uint16 emitterChain = response.encodedWormholeMessage.unsafeEmitterChainFromVaa();
        bytes32 emitterAddress = response.encodedWormholeMessage.unsafeEmitterAddressFromVaa();

        // If the emitter is the matching engine, and this TokenRouter is on the same chain
        // as the matching engine, then this is a fast fill.
        if (
            (emitterChain == _matchingEngineChain && _wormholeChainId == _matchingEngineChain)
                && emitterAddress == _matchingEngineAddress
        ) {
            return _handleFastFill(response.encodedWormholeMessage);
        } else {
            return _handleFill(emitterChain, response);
        }
    }

    // ------------------------------- Private ---------------------------------

    function _handleFill(uint16 emitterChain, OrderResponse calldata response) private returns (RedeemedFill memory) {
        ICircleIntegration.DepositWithPayload memory deposit = _wormholeCctp.redeemTokensWithPayload(
            ICircleIntegration.RedeemParameters({
                encodedWormholeMessage: response.encodedWormholeMessage,
                circleBridgeMessage: response.circleBridgeMessage,
                circleAttestation: response.circleAttestation
            })
        );

        Messages.Fill memory fill = deposit.payload.decodeFill();

        _verifyFromAddress(emitterChain, deposit.fromAddress);
        _verifyRedeemer(fill.redeemer);

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

    function _handleFastFill(bytes calldata fastFillVaa) private returns (RedeemedFill memory) {
        // Call the Matching Engine to redeem the fill directly.
        Messages.FastFill memory fastFill = IMatchingEngine(
            fromUniversalAddress(_matchingEngineAddress)
        ).redeemFastFill(fastFillVaa);

        _verifyRedeemer(fastFill.fill.redeemer);

        // Transfer token amount to redeemer.
        SafeERC20.safeTransfer(_orderToken, msg.sender, fastFill.fillAmount);

        return RedeemedFill({
            sender: fastFill.fill.orderSender,
            senderChain: fastFill.fill.sourceChain,
            token: address(_orderToken),
            amount: fastFill.fillAmount,
            message: fastFill.fill.redeemerMessage
        });
    }

    function _verifyRedeemer(bytes32 expectedRedeemer) private view {
        // Make sure the redeemer is who we expect.
        bytes32 redeemer = toUniversalAddress(msg.sender);
        if (redeemer != expectedRedeemer) {
            revert ErrInvalidRedeemer(redeemer, expectedRedeemer);
        }
    }

    function _verifyFromAddress(uint16 fromChain, bytes32 fromAddress) private view {
        if (fromChain == _matchingEngineChain) {
            if (fromAddress != _matchingEngineAddress) {
                revert ErrInvalidMatchingEngineSender(fromAddress, _matchingEngineAddress);
            }
        } else {
            bytes32 fromRouter = getRouter(fromChain);
            if (fromAddress != fromRouter) {
                revert ErrInvalidSourceRouter(fromAddress, fromRouter);
            }
        }
    }
}
