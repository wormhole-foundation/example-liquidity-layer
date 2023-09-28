// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Messages} from "../Messages.sol";
import {toUniversalAddress, fromUniversalAddress} from "../Utils.sol";

import {OrderRouterBase} from "./OrderRouterBase.sol";
import {TargetInfo, TargetType} from "./Storage.sol";

contract PlaceMarketOrder is OrderRouterBase {
	using BytesParsing for bytes;
	using Messages for *;

	error InsufficientAmount(uint256 amount, uint256 minimum);
	error MinAmountOutExceedsLimit(uint256 minAmountOut, uint256 limit);
	error InvalidTargetType(TargetType targetType);

	struct PlaceMarketOrderArgs {
		uint32 nonce;
		uint256 amountIn;
		uint256 minAmountOut;
		uint16 targetChain;
		bytes32 redeemer;
		bytes redeemerMessage;
		address refundAddress;
	}

	constructor(
		address _token,
		uint16 _matchingEngineChain,
		bytes32 _matchingEngineEndpoint,
		uint16 _canonicalTokenChain,
		bytes32 _canonicalTokenAddress,
		address _tokenBridge,
		address _wormholeCircle
	)
		OrderRouterBase(
			_token,
			_matchingEngineChain,
			_matchingEngineEndpoint,
			_canonicalTokenChain,
			_canonicalTokenAddress,
			_tokenBridge,
			_wormholeCircle
		)
	{}

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args
	) public payable returns (uint64 sequence) {
		sequence = _placeMarketOrder(args, 0, new bytes32[](0));
	}

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee
	) public payable returns (uint64 sequence) {
		sequence = _placeMarketOrder(args, relayerFee, new bytes32[](0));
	}

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) public payable returns (uint64 sequence) {
		sequence = _placeMarketOrder(args, relayerFee, allowedRelayers);
	}

	function _placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (uint64 sequence) {
		(TargetType targetType, uint256 slippage) = _computeTargetSlippage(
			args.targetChain,
			relayerFee
		);

		// The amount provided for the order must be more than the fee to execute the order plus
		// the configured relayer fee.
		if (args.amountIn < slippage) {
			revert InsufficientAmount(args.amountIn, slippage);
		}

		// The minimum amount out must not exceed the amount in less the fees.
		if (args.minAmountOut > args.amountIn - slippage) {
			revert MinAmountOutExceedsLimit(args.minAmountOut, args.amountIn - slippage);
		}

		// Transfer the order token to this contract.
		SafeERC20.safeTransferFrom(orderToken, msg.sender, address(this), args.amountIn);

		// We either need to encode an order message for the matching engine or directly encode
		// a fill message for the target chain.
		if (targetType == TargetType.MatchingEngine) {
			bytes memory encodedOrder = Messages
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
				.encode();

			if (cctpEnabled) {
				SafeERC20.safeIncreaseAllowance(orderToken, address(wormholeCircle), args.amountIn);

				sequence = wormholeCircle.transferTokensWithPayload{value: msg.value}(
					ICircleIntegration.TransferParameters({
						token: address(orderToken),
						amount: args.amountIn,
						targetChain: matchingEngineChain,
						mintRecipient: matchingEngineEndpoint
					}),
					args.nonce,
					encodedOrder
				);
			} else {
				SafeERC20.safeIncreaseAllowance(orderToken, address(tokenBridge), args.amountIn);

				sequence = tokenBridge.transferTokensWithPayload{value: msg.value}(
					address(orderToken),
					args.amountIn,
					matchingEngineChain,
					matchingEngineEndpoint,
					args.nonce,
					encodedOrder
				);
			}
		} else {
			bytes memory encodedFill = Messages
				.Fill({
					orderSender: toUniversalAddress(msg.sender),
					redeemer: args.redeemer,
					redeemerMessage: args.redeemerMessage
				})
				.encode();

			if (cctpEnabled && targetType == TargetType.Cctp) {
				SafeERC20.safeIncreaseAllowance(orderToken, address(wormholeCircle), args.amountIn);

				sequence = wormholeCircle.transferTokensWithPayload{value: msg.value}(
					ICircleIntegration.TransferParameters({
						token: address(orderToken),
						amount: args.amountIn,
						targetChain: args.targetChain,
						mintRecipient: getEndpoint(args.targetChain)
					}),
					args.nonce,
					encodedFill
				);
			} else if (canonicalEnabled && targetType == TargetType.Canonical) {
				SafeERC20.safeIncreaseAllowance(orderToken, address(tokenBridge), args.amountIn);

				sequence = tokenBridge.transferTokensWithPayload{value: msg.value}(
					address(orderToken),
					args.amountIn,
					args.targetChain,
					getEndpoint(args.targetChain),
					args.nonce,
					encodedFill
				);
			} else {
				// This should never happen.
				revert InvalidTargetType(targetType);
			}
		}
	}

	function _computeTargetSlippage(
		uint16 targetChain,
		uint256 relayerFee
	) internal view returns (TargetType targetType, uint256 slippage) {
		TargetInfo memory info = getTargetInfo(targetChain);
		return (info.targetType, uint256(info.slippage) + relayerFee);
	}
}
