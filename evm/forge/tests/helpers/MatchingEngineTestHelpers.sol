// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";

import {toUniversalAddress, fromUniversalAddress} from "../../../src/shared/Utils.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenMinter} from "cctp-solidity/ITokenMinter.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {SigningWormholeSimulator} from "wormhole-solidity/WormholeSimulator.sol";
import {Messages} from "../../../src/shared/Messages.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface WrappedToken {
    function mint(address to, uint256 amount) external;
}

contract TestHelpers is Test {
    using Messages for *;

    // Error.
    error IndexNotFound();

    // Circle contracts.
    bytes32 immutable AVAX_CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("AVAX_CIRCLE_BRIDGE"));
    bytes32 immutable ARB_CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("ARB_CIRCLE_BRIDGE"));
    bytes32 immutable ARB_CIRCLE_INTEGRATION =
        toUniversalAddress(vm.envAddress("ARB_CIRCLE_INTEGRATION"));

    // State.
    SigningWormholeSimulator sim;
    ITokenBridge bridge;
    ICircleIntegration circleIntegration;
    CircleSimulator circleSim;
    bytes32 matchingEngine;
    uint16 matchingEngineChain;
    address testSender;
    address testRedeemer;
    address testRefundAddress;

    function _initializeTestHelper(
        SigningWormholeSimulator _sim,
        CircleSimulator _circleSimulator,
        address _bridge,
        address _circleIntegration,
        address _matchingEngine,
        uint16 _matchingEngineChain,
        address _testSender,
        address _testRedeemer,
        address _testRefundAddress
    ) internal {
        sim = _sim;
        circleSim = _circleSimulator;
        bridge = ITokenBridge(_bridge);
        circleIntegration = ICircleIntegration(_circleIntegration);
        matchingEngine = toUniversalAddress(_matchingEngine);
        matchingEngineChain = _matchingEngineChain;
        testSender = _testSender;
        testRedeemer = _testRedeemer;
        testRefundAddress = _testRefundAddress;
    }

    function _createSignedVaa(
        uint32 timestamp,
        uint16 emitterChainId,
        bytes32 emitterAddress,
        bytes memory payload
    ) internal view returns (bytes memory) {
        IWormhole.VM memory vaa = IWormhole.VM({
            version: 1,
            timestamp: timestamp,
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

    function createCircleMessage(
        ICircleIntegration.DepositWithPayload memory deposit
    ) internal view returns (bytes memory) {
        CircleSimulator.CircleMessage memory circleMessage;

        // version
        circleMessage.version = 0;
        circleMessage.sourceDomain = deposit.sourceDomain;
        circleMessage.targetDomain = deposit.targetDomain;
        circleMessage.nonce = deposit.nonce;
        circleMessage.sourceCircle = ARB_CIRCLE_BRIDGE;
        circleMessage.targetCircle = AVAX_CIRCLE_BRIDGE;
        circleMessage.targetCaller = toUniversalAddress((address(circleIntegration)));
        circleMessage.token = deposit.token;
        circleMessage.mintRecipient = deposit.mintRecipient;
        circleMessage.amount = deposit.amount;
        circleMessage.transferInitiator = ARB_CIRCLE_INTEGRATION;

        return circleSim.encodeBurnMessageLog(circleMessage);
    }

    function _craftValidCCTPMarketOrder(
        uint256 timestamp,
        uint256 amount,
        bytes32 tokenAddress,
        bytes32 router,
        bytes32 emitterAddress,
        uint16 emitterChainId,
        bytes memory payload
    ) internal view returns (ICircleIntegration.RedeemParameters memory redeemParameters) {
        ICircleIntegration.DepositWithPayload memory deposit = ICircleIntegration
            .DepositWithPayload({
                amount: amount,
                token: tokenAddress,
                sourceDomain: circleIntegration.getDomainFromChainId(emitterChainId),
                targetDomain: circleIntegration.localDomain(), // target is always avax
                nonce: 0,
                fromAddress: router,
                mintRecipient: matchingEngine,
                payload: payload
            });

        // Package the redeem parameters.
        redeemParameters.encodedWormholeMessage = _createSignedVaa(
            uint32(timestamp),
            emitterChainId,
            emitterAddress,
            circleIntegration.encodeDepositWithPayload(deposit)
        );
        redeemParameters.circleBridgeMessage = createCircleMessage(deposit);
        redeemParameters.circleAttestation = circleSim.attestCircleMessage(
            redeemParameters.circleBridgeMessage
        );
    }

    function _craftValidTokenBridgeMarketOrder(
        uint256 timestamp,
        uint256 amount,
        bytes32 tokenAddress,
        uint16 tokenChain,
        bytes32 fromRouter,
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
            fromAddress: fromRouter,
            payload: payload
        });

        bytes memory transferPayload = bridge.encodeTransferWithPayload(transfer);

        return _createSignedVaa(uint32(timestamp), emitterChainId, emitterAddress, transferPayload);
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

    function _assertCCTPMessage(
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

    function _assertOrderRevertPayloadCCTP(
        IWormhole.VM memory vm,
        uint8 reason,
        bytes32 refundAddress
    ) internal {
        ICircleIntegration.DepositWithPayload memory deposit = circleIntegration
            .decodeDepositWithPayload(vm.payload);

        Messages.OrderRevert memory orderRevert = Messages.decodeOrderRevert(deposit.payload);
        assertEq(uint8(orderRevert.reason), reason);
        assertEq(orderRevert.refundAddress, refundAddress);
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

    function _assertOrderRevertPayloadTokenBridge(
        IWormhole.VM memory vm,
        uint8 reason,
        bytes32 refundAddress
    ) internal {
        ITokenBridge.TransferWithPayload memory transfer = bridge.parseTransferWithPayload(
            vm.payload
        );

        Messages.OrderRevert memory orderRevert = Messages.decodeOrderRevert(transfer.payload);
        assertEq(uint8(orderRevert.reason), reason);
        assertEq(orderRevert.refundAddress, refundAddress);
    }

    function _increaseWrappedSupply(address token, uint256 amount) internal {
        // Only the bridge can mint tokens.
        vm.prank(address(bridge));
        WrappedToken(token).mint(makeAddr("moarTokens"), amount);
    }

    function _createAllowedRelayerArray(uint256 relayerCount) internal returns (bytes32[] memory) {
        bytes32[] memory allowedRelayers = new bytes32[](relayerCount);
        for (uint256 i = 0; i < relayerCount; i++) {
            allowedRelayers[i] = toUniversalAddress(
                makeAddr(string.concat(string("relayer"), Strings.toString(i)))
            );
        }
        return allowedRelayers;
    }
}
