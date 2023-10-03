// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
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
	using BytesParsing for bytes;
	using Messages for *;

	/**
	 * @notice Redeem a fill sent by either another Order Router or the Matching Engine.
	 */
	function redeemFill(bytes calldata encodedVaa) external payable returns (RedeemedFill memory) {
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
	) external payable returns (RedeemedFill memory) {
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
		TokenType expectedTokenType,
		bytes32 fromAddress,
		uint256 amount,
		bytes memory payload
	) internal view returns (RedeemedFill memory) {
		uint16 emitterChain = _getEmitterChainFromVaa(encodedVaa);

		RouterInfo memory src = this.getRouterInfo(emitterChain);

		// We only trust either the Matching Engine or another order router to send us fills. If
		// this message came from another order router, both this router and the source router must
		// be TokenType.Canonical.
		if (src.tokenType == expectedTokenType && src.tokenType == expectedTokenType) {
			if (fromAddress != src.endpoint) {
				revert ErrInvalidSourceRouter(fromAddress);
			}
		} else if (fromAddress != matchingEngineEndpoint) {
			revert ErrSourceNotMatchingEngine(fromAddress);
		}

		// Parse the fill.
		Messages.Fill memory fill = payload.decodeFill();
		if (toUniversalAddress(msg.sender) != fill.redeemer) {
			revert ErrInvalidFillRedeemer(toUniversalAddress(msg.sender), fill.redeemer);
		}

		return
			RedeemedFill({
				sender: fill.orderSender,
				senderChain: fill.sourceChain,
				token: address(orderToken),
				amount: amount,
				message: fill.redeemerMessage
			});
	}

	function _getEmitterChainFromVaa(bytes memory encodedVaa) internal pure returns (uint16 chain) {
		(chain, ) = encodedVaa.asUint16Unchecked(6 + uint256(uint8(encodedVaa[5])) * 66);
	}
}
