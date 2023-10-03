// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";

import {toUniversalAddress, fromUniversalAddress} from "../../src/shared/Utils.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {SigningWormholeSimulator} from "wormhole-solidity/WormholeSimulator.sol";
import {Messages} from "../../src/shared/Messages.sol";

contract TestHelpers is Test {
	using Messages for *;

	// Error.
	error IndexNotFound();

	// State.
	SigningWormholeSimulator sim;
	ITokenBridge bridge;
	ICircleIntegration circleIntegration;
	address[4] coins;
	bytes32 matchingEngine;
	uint16 matchingEngineChain;
	address testSender;
	address testRedeemer;
	address testRefundAddress;

	function _initializeTestHelper(
		SigningWormholeSimulator _sim,
		address _bridge,
		address _circleIntegration,
		address[4] memory _coins,
		address _matchingEngine,
		uint16 _matchingEngineChain,
		address _testSender,
		address _testRedeemer,
		address _testRefundAddress
	) internal {
		sim = _sim;
		bridge = ITokenBridge(_bridge);
		circleIntegration = ICircleIntegration(_circleIntegration);
		coins = _coins;
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
	) internal view returns (bytes memory) {
		IWormhole.VM memory vaa = IWormhole.VM({
			version: 1,
			timestamp: 1234567,
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
	) internal view returns (bytes memory) {
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

	function _encodeTestMarketOrder(
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

	function _assertTokenBridgeMessage(
		IWormhole.VM memory vm,
		uint256 amount,
		bytes32 tokenAddress,
		uint16 tokenChain,
		bytes32 to,
		uint16 toChain,
		bytes32 fromAddress
	) internal {
		ITokenBridge.TransferWithPayload memory transfer = bridge.parseTransferWithPayload(
			vm.payload
		);

		// Verify values.
		assertEq(transfer.amount, amount);
		assertEq(transfer.tokenAddress, tokenAddress);
		assertEq(transfer.tokenChain, tokenChain);
		assertEq(transfer.to, to);
		assertEq(transfer.toChain, toChain);
		assertEq(transfer.fromAddress, fromAddress);
	}

	function _assertCircleIntegrationMessage(
		IWormhole.VM memory vm,
		uint256 amount,
		bytes32 tokenAddress,
		bytes32 mintRecipient,
		uint16 toChain,
		bytes32 fromAddress
	) internal {
		ICircleIntegration.DepositWithPayload memory deposit = circleIntegration
			.decodeDepositWithPayload(vm.payload);

		// Verify values.
		assertEq(deposit.amount, amount);
		assertEq(deposit.token, tokenAddress);
		assertEq(circleIntegration.getChainIdFromDomain(deposit.targetDomain), toChain);
		assertEq(deposit.fromAddress, fromAddress);
		assertEq(deposit.mintRecipient, mintRecipient);
	}

	function _assertFillPayloadCCTP(
		IWormhole.VM memory vm,
		uint16 sourceChain,
		bytes memory redeemerMessage
	) internal {
		ICircleIntegration.DepositWithPayload memory deposit = circleIntegration
			.decodeDepositWithPayload(vm.payload);

		Messages.Fill memory fill = Messages.decodeFill(deposit.payload);
		assertEq(fill.sourceChain, sourceChain);
		assertEq(fill.orderSender, toUniversalAddress(testSender));
		assertEq(fill.redeemer, toUniversalAddress(testRedeemer));
		assertEq(fill.redeemerMessage, redeemerMessage);
	}

	function _assertFillPayloadTokenBridge(
		IWormhole.VM memory vm,
		uint16 sourceChain,
		bytes memory redeemerMessage
	) internal {
		ITokenBridge.TransferWithPayload memory transfer = bridge.parseTransferWithPayload(
			vm.payload
		);

		Messages.Fill memory fill = Messages.decodeFill(transfer.payload);
		assertEq(fill.sourceChain, sourceChain);
		assertEq(fill.orderSender, toUniversalAddress(testSender));
		assertEq(fill.redeemer, toUniversalAddress(testRedeemer));
		assertEq(fill.redeemerMessage, redeemerMessage);
	}
}
