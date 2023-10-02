// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {toUniversalAddress, fromUniversalAddress} from "../../src/shared/Utils.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {SigningWormholeSimulator} from "wormhole-solidity/WormholeSimulator.sol";
import {Messages} from "../../src/shared/Messages.sol";

contract TestHelpers {
	using Messages for *;

	// State.
	SigningWormholeSimulator sim;
	ITokenBridge bridge;
	bytes32 matchingEngine;
	uint16 matchingEngineChain;
	address testSender;
	address testRedeemer;
	address testRefundAddress;

	function _initializeTestHelper(
		SigningWormholeSimulator _sim,
		address _bridge,
		address _matchingEngine,
		uint16 _matchingEngineChain,
		address _testSender,
		address _testRedeemer,
		address _testRefundAddress
	) internal {
		sim = _sim;
		bridge = ITokenBridge(_bridge);
		matchingEngine = toUniversalAddress(_matchingEngine);
		matchingEngineChain = _matchingEngineChain;
		testSender = _testSender;
		testRedeemer = _testRedeemer;
		testRefundAddress = _testRefundAddress;
	}

	function _createSignedVaa(
		uint16 emitterChainId,
		bytes32 emitterAddress,
		bytes memory payload
	) internal returns (bytes memory) {
		IWormhole.VM memory vaa = IWormhole.VM({
			version: 1,
			timestamp: 0,
			nonce: 0,
			emitterChainId: emitterChainId,
			emitterAddress: emitterAddress,
			sequence: 0,
			consistencyLevel: 1,
			payload: payload,
			guardianSetIndex: sim.currentGuardianSetIndex(),
			signatures: new IWormhole.Signature[](0),
			hash: 0x00
		});

		return sim.encodeAndSignMessage(vaa);
	}

	function _craftValidMarketOrder(
		uint256 amount,
		bytes32 tokenAddress,
		uint16 tokenChain,
		bytes32 router,
		bytes32 emitterAddress,
		uint16 emitterChainId,
		bytes memory payload
	) internal returns (bytes memory) {
		ITokenBridge.TransferWithPayload memory transfer = ITokenBridge.TransferWithPayload({
			payloadID: uint8(3), // payload3 transfer
			amount: amount,
			tokenAddress: tokenAddress,
			tokenChain: tokenChain,
			to: matchingEngine,
			toChain: matchingEngineChain,
			fromAddress: router,
			payload: payload
		});

		bytes memory transferPayload = bridge.encodeTransferWithPayload(transfer);

		return _createSignedVaa(emitterChainId, emitterAddress, transferPayload);
	}

	function _encodeMarketOrder(
		uint256 minAmountOut,
		uint16 targetChain,
		bytes memory payload,
		uint256 relayerFee,
		bytes32[] memory allowedRelayers
	) internal view returns (bytes memory) {
		return
			Messages
				.MarketOrder({
					minAmountOut: minAmountOut,
					targetChain: targetChain,
					redeemer: toUniversalAddress(testRedeemer),
					redeemerMessage: payload,
					sender: toUniversalAddress(testSender),
					refundAddress: toUniversalAddress(testRefundAddress),
					relayerFee: relayerFee,
					allowedRelayers: allowedRelayers
				})
				.encode();
	}
}
