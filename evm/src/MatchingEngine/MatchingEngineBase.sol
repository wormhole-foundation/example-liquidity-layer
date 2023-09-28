// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Messages} from "../Messages.sol";
import {getExecutionRoute, Route, getRegisteredOrderRouters, CurvePoolInfo, getCurvePoolInfo} from "./MatchingEngineStorage.sol";

contract MatchingEngineBase {
	using Messages for *;

	uint16 private immutable _chainId;
	IWormhole private immutable _wormhole;
	ITokenBridge private immutable _tokenBridge;
	ICircleIntegration private immutable _circleIntegration;

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

	function executeOrder(bytes calldata vaa) public payable {
		// parse and verify the vaa
		// see if the token is registered
	}

	function executeOrder(
		ICircleIntegration.RedeemParameters calldata redeemParams
	) public payable {
		/**
		 * Mint tokens to this contract. Serves as a reentrancy protection,
		 * since the circle integration contract will not allow the wormhole
		 * message in the redeemParams to be replayed.
		 */
		ICircleIntegration.DepositWithPayload memory deposit = _circleIntegration
			.redeemTokensWithPayload(redeemParams);

		// Convert the CCTP `sourceDomain` to Wormhole chain ID.
		uint16 fromChain = _circleIntegration.getChainIdFromDomain(deposit.sourceDomain);
		if (deposit.fromAddress != getRegisteredOrderRouters().registered[fromChain]) {
			revert UnregisteredOrderRouter();
		}

		// Parse the market order.
		Messages.MarketOrder memory order = deposit.payload.decodeMarketOrder();
		address token = fromWormholeFormat(deposit.token);

		// Pay the msg.sender if they're an allowed relayer and the market order
		// specifies a nonzero relayer fee.
		uint256 amountIn = _handleRelayerFee(
			token,
			deposit.amount,
			order.relayerFee,
			order.allowedRelayers
		);

		// Determine if the target route is enabled. This contract should
		// not receive a circle integration message if the target route is
		// a CCTP chain.
		Route memory route = getExecutionRoute().routes[order.targetChain];
		if (route.target == address(0) || route.cctp) {
			revert InvalidRoute();
		}

		// Execute curve swap. The amountOut will be zero if the
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

		// TODO: see how curve handles failed swap.
		if (amountOut == 0) {
			_handleFailedSwap();
		}

		_handleBridgeOut();
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
		uint256 amountIn,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal returns (uint256) {
		if (relayerFee == 0) {
			return amountIn;
		}

		uint256 relayerCount = allowedRelayers.length;
		bytes32 relayer = toWormholeFormat(msg.sender);

		// Check if the msg.sender is an allowed relayer.
		bool allowed = false;
		if (relayerCount == 0) {
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

	function _handleFailedSwap() internal pure {
		return;
	}

	function _handleBridgeOut() internal pure returns (uint64 sequence) {
		// TODO: safe approve the bridge
		// sequence = _tokenBridge.transferTokensWithPayload(
		// 	token,
		// 	amount,
		// 	recipientChain,
		// 	recipient,
		// 	nonce,
		// 	payload
		// );
		return 69;
	}

	function toWormholeFormat(address addr) public pure returns (bytes32 whFormat) {
		return bytes32(uint256(uint160(addr)));
	}

	function fromWormholeFormat(bytes32 whFormatAddress) public pure returns (address addr) {
		return address(uint160(uint256(whFormatAddress)));
	}
}
