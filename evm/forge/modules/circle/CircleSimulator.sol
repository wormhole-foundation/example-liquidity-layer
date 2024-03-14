// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.13;

import "local-modules/wormhole/BytesLib.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMessageTransmitter} from "src/interfaces/external/IMessageTransmitter.sol";

import "forge-std/Vm.sol";
import "forge-std/console.sol";

contract CircleSimulator {
    using BytesLib for bytes;

    address circleTransmitter;
    uint256 signerPK;

    // Taken from forge-std/Script.sol
    address private constant VM_ADDRESS =
        address(bytes20(uint160(uint256(keccak256("hevm cheat code")))));
    Vm public constant vm = Vm(VM_ADDRESS);

    constructor(uint256 signerPK_, address circleTransmitter_) {
        signerPK = signerPK_;
        circleTransmitter = circleTransmitter_;
    }

    /**
     * @notice Disables the Circle Bridge attester key, and replaces it with a key
     * of the user's choice.
     */
    function setupCircleAttester() public {
        // instantiate circle attester
        IMessageTransmitter transmitter = IMessageTransmitter(circleTransmitter);

        // enable the guardian key as an attester
        vm.startPrank(transmitter.attesterManager());

        // set the signature threshold to 1
        transmitter.setSignatureThreshold(1);

        // enable our key as the attester
        transmitter.enableAttester(vm.addr(signerPK));

        vm.stopPrank();
    }

    /// @notice Attests Circle messages
    function attestCircleMessage(bytes memory circleMessage) public view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPK, keccak256(circleMessage));
        return abi.encodePacked(r, s, v);
    }

    /**
     * @notice Finds published Circle burn events in forge logs
     * @param logs The forge Vm.log captured when recording events during test
     * execution.
     * @param numMessages The expected number of burn events in the forge logs
     */
    function fetchBurnMessageFromLog(Vm.Log[] memory logs, uint8 numMessages)
        public
        pure
        returns (Vm.Log[] memory)
    {
        // create log array to save published messages
        Vm.Log[] memory published = new Vm.Log[](numMessages);

        uint8 publishedIndex = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("MessageSent(bytes)")) {
                published[publishedIndex] = logs[i];
                publishedIndex += 1;
            }
        }

        return published;
    }

    struct CircleMessage {
        uint32 version;
        uint32 sourceDomain;
        uint32 targetDomain;
        uint64 nonce;
        bytes32 sourceCircle;
        bytes32 targetCircle;
        bytes32 targetCaller;
        bytes32 token;
        bytes32 mintRecipient;
        uint256 amount;
        bytes32 transferInitiator;
    }

    /// @notice Decodes recorded Circle Bridge messages in forge tests
    function decodeBurnMessageLog(bytes memory encoded)
        public
        pure
        returns (CircleMessage memory parsed)
    {
        uint256 index = 64;

        // version
        parsed.version = encoded.toUint32(index);
        index += 4;

        // source domain
        parsed.sourceDomain = encoded.toUint32(index);
        index += 4;

        // target domain
        parsed.targetDomain = encoded.toUint32(index);
        index += 4;

        // nonce
        parsed.nonce = encoded.toUint64(index);
        index += 8;

        // source circle bridge address
        parsed.sourceCircle = encoded.toBytes32(index);
        index += 32;

        // target circle bridge address
        parsed.targetCircle = encoded.toBytes32(index);
        index += 32;

        // target redeemer address
        parsed.targetCaller = encoded.toBytes32(index);
        index += 32;

        // skip random bytes
        index += 4;

        // token address
        parsed.token = encoded.toBytes32(index);
        index += 32;

        // mint recipient address
        parsed.mintRecipient = encoded.toBytes32(index);
        index += 32;

        // source circle bridge address
        parsed.amount = encoded.toUint256(index);
        index += 32;

        // caller of burn tx
        parsed.transferInitiator = encoded.toBytes32(index);
        index += 32;

        // skip random bytes
        index += 8;

        require(index == encoded.length, "invalid circle message");
    }

    /// @notice Encodes Circle Bridge messages
    function encodeBurnMessageLog(CircleMessage memory parsed) public pure returns (bytes memory) {
        return abi.encodePacked(
            parsed.version,
            parsed.sourceDomain,
            parsed.targetDomain,
            parsed.nonce,
            parsed.sourceCircle,
            parsed.targetCircle,
            parsed.targetCaller,
            bytes4(0),
            parsed.token,
            parsed.mintRecipient,
            parsed.amount,
            parsed.transferInitiator
        );
    }

    /// @notice Queries the Circle Bridge for the next available nonce
    function nextNonce(uint32 domain) public view returns (uint64) {
        return IMessageTransmitter(circleTransmitter).availableNonces(domain);
    }
}
