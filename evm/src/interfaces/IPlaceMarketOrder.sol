// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {TargetType} from "./Types.sol";

struct PlaceMarketOrderArgs {
	uint256 amountIn;
	uint256 minAmountOut;
	uint16 targetChain;
	bytes32 redeemer;
	bytes redeemerMessage;
	address refundAddress;
}

error ErrInsufficientAmount(uint256 amount, uint256 minimum);
error ErrMinAmountOutExceedsLimit(uint256 minAmountOut, uint256 limit);
error ErrTargetChainNotSupported(uint16 targetChain);

interface IPlaceMarketOrder {
	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args
	) external payable returns (uint64 sequence);

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee
	) external payable returns (uint64 sequence);

	function placeMarketOrder(
		PlaceMarketOrderArgs calldata args,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) external payable returns (uint64 sequence);
}
