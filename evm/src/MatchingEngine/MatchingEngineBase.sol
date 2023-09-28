// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Messages} from "../Messages.sol";
import {toUniversalAddress, fromUniversalAddress} from "../Utils.sol";
import {getExecutionRoute, Route, RegisteredOrderRouters, getRegisteredOrderRouters, CurvePoolInfo, getCurvePoolInfo} from "./Storage.sol";

contract MatchingEngineBase {
	using Messages for *;

	// Immutable state.
	uint16 private immutable _chainId;
	IWormhole private immutable _wormhole;
	ITokenBridge private immutable _tokenBridge;
	ICircleIntegration private immutable _circleIntegration;

	// Consts.
	uint256 public constant RELAY_TIMEOUT = 900; // seconds
	uint32 private constant NONCE = 0;

	// Errors.
	error InvalidRoute();
	error UnregisteredOrderRouter();
	error NotAllowedRelayer();

	constructor(
		address tokenBridge,
		address circleIntegration,
		address curve,
		int8 nativeTokenPoolIndex
	) {
		_tokenBridge = ITokenBridge(tokenBridge);
		_circleIntegration = ICircleIntegration(circleIntegration);
		_chainId = _tokenBridge.chainId();
		_wormhole = _tokenBridge.wormhole();

		// Set curve pool info in storage.
		CurvePoolInfo storage info = getCurvePoolInfo();
		info.pool = ICurvePool(curve);
		info.nativeTokenIndex = nativeTokenPoolIndex;
	}

	function executeOrder(bytes calldata vaa) public payable returns (uint64) {
		// parse and verify the vaa
		// see if the token is registered
		return 69;
	}

	function executeOrder(
		ICircleIntegration.RedeemParameters calldata redeemParams
	) public payable returns (uint64 sequence) {
		/**
		 * Mint tokens to this contract. Serves as a reentrancy protection,
		 * since the circle integration contract will not allow the wormhole
		 * message in the redeemParams to be replayed.
		 */
		ICircleIntegration.DepositWithPayload memory deposit = _circleIntegration
			.redeemTokensWithPayload(redeemParams);

		// Parse the market order.
		Messages.MarketOrder memory order = deposit.payload.decodeMarketOrder();

		// Check that the from/to order routers are registered with this contract.
		RegisteredOrderRouters storage routers = getRegisteredOrderRouters();
		uint16 fromChain = _circleIntegration.getChainIdFromDomain(deposit.sourceDomain);
		if (
			deposit.fromAddress != routers.registered[fromChain] ||
			routers.registered[order.targetChain] == bytes32(0)
		) {
			revert UnregisteredOrderRouter();
		}

		// Determine if the target route is enabled. This contract should
		// not receive a circle integration message if the target route is
		// a CCTP chain.
		Route memory route = getExecutionRoute().routes[order.targetChain];
		if (route.target == address(0) || route.cctp) {
			revert InvalidRoute();
		}

		// Pay the msg.sender if they're an allowed relayer and the market order
		// specifies a nonzero relayer fee.
		address token = fromUniversalAddress(deposit.token);
		uint256 amountIn = _handleRelayerFee(
			token,
			redeemParams.encodedWormholeMessage.decodeWormholeTimestamp(),
			deposit.amount,
			order.relayerFee,
			order.allowedRelayers
		);

		// Execute curve swap. The `amountOut` will be zero if the
		// swap fails for any reason.
		CurvePoolInfo memory curve = getCurvePoolInfo();
		uint256 amountOut = _handleSwap(
			token,
			address(curve.pool),
			int128(curve.nativeTokenIndex),
			int128(route.poolIndex),
			amountIn,
			order.minAmountOut
		);

		// If the swap failed, revert the order and refund the redeemer on
		// the origin chain. Otherwise, bridge the swapped token to the
		// destination chain.
		if (amountOut == 0) {
			sequence = _handleCCTPOut(
				token,
				amountIn, // Send full amount back.
				fromChain,
				routers.registered[fromChain],
				Messages
					.OrderRevert({
						reason: Messages.RevertType.SwapFailed,
						refundAddress: order.refundAddress
					})
					.encode()
			);
		} else {
			sequence = _handleBridgeOut(
				route.target,
				amountOut,
				order.targetChain,
				routers.registered[order.targetChain],
				Messages
					.Fill({
						orderSender: order.sender,
						redeemer: order.redeemer,
						redeemerMessage: order.redeemerMessage
					})
					.encode()
			);
		}
	}

	function _handleSwap(
		address token,
		address swapPool,
		int128 fromIndex,
		int128 toIndex,
		uint256 amountIn,
		uint256 minAmountOut
	) internal returns (uint256) {
		SafeERC20.safeApprove(IERC20(token), swapPool, amountIn);

		// Perform the swap.
		(bool success, bytes memory result) = swapPool.call(
			abi.encodeWithSelector(
				ICurvePool.exchange.selector,
				fromIndex,
				toIndex,
				amountIn,
				minAmountOut
			)
		);

		if (success) {
			return abi.decode(result, (uint256));
		} else {
			return 0;
		}
	}

	function _handleRelayerFee(
		address token,
		uint256 messageTime,
		uint256 amountIn,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (uint256) {
		if (relayerFee == 0) {
			return amountIn;
		}

		uint256 relayerCount = allowedRelayers.length;
		bytes32 relayer = toUniversalAddress(msg.sender);

		// Check if the msg.sender is an allowed relayer.
		bool allowed = false;
		if (relayerCount == 0 || block.timestamp > messageTime + RELAY_TIMEOUT) {
			allowed = true;
		} else {
			for (uint256 i = 0; i < relayerCount; ) {
				if (relayer == allowedRelayers[i]) {
					allowed = true;
					break;
				}

				unchecked {
					++i;
				}
			}
		}

		if (!allowed) {
			revert NotAllowedRelayer();
		}

		SafeERC20.safeTransfer(IERC20(token), msg.sender, relayerFee);

		return amountIn - relayerFee;
	}

	function _handleBridgeOut(
		address token,
		uint256 amount,
		uint16 recipientChain,
		bytes32 recipient,
		bytes memory payload
	) internal returns (uint64 sequence) {
		SafeERC20.safeApprove(IERC20(token), address(_tokenBridge), amount);
		sequence = _tokenBridge.transferTokensWithPayload{value: msg.value}(
			token,
			amount,
			recipientChain,
			recipient,
			NONCE,
			payload
		);
	}

	function _handleCCTPOut(
		address token,
		uint256 amount,
		uint16 recipientChain,
		bytes32 recipient,
		bytes memory payload
	) internal returns (uint64 sequence) {
		SafeERC20.safeApprove(IERC20(token), address(_circleIntegration), amount);
		sequence = _circleIntegration.transferTokensWithPayload(
			ICircleIntegration.TransferParameters({
				token: token,
				amount: amount,
				targetChain: recipientChain,
				mintRecipient: recipient
			}),
			NONCE,
			payload
		);
	}
}
