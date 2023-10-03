// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../../shared/Admin.sol";
import {Messages} from "../../shared/Messages.sol";
import {toUniversalAddress, fromUniversalAddress} from "../../shared/Utils.sol";

import {State} from "./State.sol";

import "../../interfaces/IPlaceMarketOrder.sol";
import {TargetInfo} from "../../interfaces/Types.sol";

abstract contract PlaceMarketOrder is IPlaceMarketOrder, Admin, State {
	using BytesParsing for bytes;
	using Messages for *;

	uint256 public constant MAX_NUM_RELAYERS = 8;

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args
	) external payable notPaused returns (uint64 sequence) {
		sequence = _placeMarketOrder(args, 0, new bytes32[](0));
	}

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee
	) external payable notPaused returns (uint64 sequence) {
		sequence = _placeMarketOrder(args, relayerFee, new bytes32[](0));
	}

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) external payable notPaused returns (uint64 sequence) {
		if (allowedRelayers.length > MAX_NUM_RELAYERS) {
			revert ErrTooManyRelayers(allowedRelayers.length, MAX_NUM_RELAYERS);
		}
		sequence = _placeMarketOrder(args, relayerFee, allowedRelayers);
	}

	function _placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (uint64 sequence) {
		(TokenType targetTokenType, uint256 slippage) = _computeTargetSlippage(
			args.targetChain,
			relayerFee
		);

		// The amount provided for the order must be more than the fee to execute the order plus
		// the configured relayer fee.
		if (args.amountIn < slippage) {
			revert ErrInsufficientAmount(args.amountIn, slippage);
		}

		// The minimum amount out must not exceed the amount in less the fees.
		if (args.minAmountOut > args.amountIn - slippage) {
			revert ErrMinAmountOutExceedsLimit(args.minAmountOut, args.amountIn - slippage);
		}

		// Transfer the order token to this contract.
		SafeERC20.safeTransferFrom(orderToken, msg.sender, address(this), args.amountIn);

		// We either need to encode an order message for the matching engine or directly encode
		// a fill message for the target chain.
		if (tokenType == TokenType.Cctp) {
			if (targetTokenType == TokenType.Cctp) {
				sequence = _handleCctpToCctp(args);
			} else {
				sequence = _handleCctpToMatchingEngine(args, relayerFee, allowedRelayers);
			}
		} else if (tokenType == TokenType.Canonical && targetTokenType == TokenType.Canonical) {
			sequence = _handleCanonicalToCanonical(args);
		} else {
			sequence = _handleBridgeToMatchingEngine(args, relayerFee, allowedRelayers);
		}
	}

	function _handleCctpToCctp(
		PlaceMarketOrderArgs calldata args
	) internal returns (uint64 sequence) {
		SafeERC20.safeIncreaseAllowance(orderToken, address(wormholeCctp), args.amountIn);

		sequence = wormholeCctp.transferTokensWithPayload{value: msg.value}(
			ICircleIntegration.TransferParameters({
				token: address(orderToken),
				amount: args.amountIn,
				targetChain: args.targetChain,
				mintRecipient: getEndpoint(args.targetChain)
			}),
			0, // nonce
			Messages
				.Fill({
					orderSender: toUniversalAddress(msg.sender),
					redeemer: args.redeemer,
					redeemerMessage: args.redeemerMessage
				})
				.encode()
		);
	}

	function _handleCanonicalToCanonical(
		PlaceMarketOrderArgs calldata args
	) internal returns (uint64 sequence) {
		SafeERC20.safeIncreaseAllowance(orderToken, address(tokenBridge), args.amountIn);

		sequence = tokenBridge.transferTokensWithPayload{value: msg.value}(
			address(orderToken),
			args.amountIn,
			args.targetChain,
			getEndpoint(args.targetChain),
			0, // nonce
			Messages
				.Fill({
					orderSender: toUniversalAddress(msg.sender),
					redeemer: args.redeemer,
					redeemerMessage: args.redeemerMessage
				})
				.encode()
		);
	}

	function _handleCctpToMatchingEngine(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (uint64 sequence) {
		SafeERC20.safeIncreaseAllowance(orderToken, address(wormholeCctp), args.amountIn);

		if (orderRouterChain == matchingEngineChain) {
			// TODO: Invoke the matching engine directly.
			revert("Not implemented");
		} else {
			sequence = wormholeCctp.transferTokensWithPayload{value: msg.value}(
				ICircleIntegration.TransferParameters({
					token: address(orderToken),
					amount: args.amountIn,
					targetChain: matchingEngineChain,
					mintRecipient: matchingEngineEndpoint
				}),
				0, // nonce
				Messages
					.MarketOrder({
						minAmountOut: args.minAmountOut,
						targetChain: args.targetChain,
						redeemer: args.redeemer,
						sender: toUniversalAddress(msg.sender),
						refundAddress: toUniversalAddress(args.refundAddress),
						redeemerMessage: args.redeemerMessage,
						relayerFee: relayerFee,
						allowedRelayers: allowedRelayers
					})
					.encode()
			);
		}
	}

	function _handleBridgeToMatchingEngine(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (uint64 sequence) {
		SafeERC20.safeIncreaseAllowance(orderToken, address(tokenBridge), args.amountIn);

		sequence = tokenBridge.transferTokensWithPayload{value: msg.value}(
			address(orderToken),
			args.amountIn,
			matchingEngineChain,
			matchingEngineEndpoint,
			0, // nonce
			Messages
				.MarketOrder({
					minAmountOut: args.minAmountOut,
					targetChain: args.targetChain,
					redeemer: args.redeemer,
					sender: toUniversalAddress(msg.sender),
					refundAddress: toUniversalAddress(args.refundAddress),
					redeemerMessage: args.redeemerMessage,
					relayerFee: relayerFee,
					allowedRelayers: allowedRelayers
				})
				.encode()
		);
	}

	function _computeTargetSlippage(
		uint16 targetChain,
		uint256 relayerFee
	) internal view returns (TokenType, uint256) {
		TargetInfo memory info = getTargetInfo(targetChain);

		// Target chain must be registered with the order router.
		if (info.tokenType == TokenType.Unset) {
			revert ErrUnsupportedTargetChain(targetChain);
		}

		return (info.tokenType, uint256(info.slippage) + relayerFee);
	}
}
