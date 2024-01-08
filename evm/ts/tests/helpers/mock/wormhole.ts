import {
    CONTRACTS,
    ChainName,
    coalesceChainId,
    tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";
import { MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";
import { ethers } from "ethers";
import { EvmObserver } from ".";
import { parseEvmEvents, parseEvmEvent } from "../../../src";
import { GUARDIAN_PRIVATE_KEY, WORMHOLE_GUARDIAN_SET_INDEX } from "../consts";

export class GuardianNetwork implements EvmObserver<Buffer> {
    guardians: MockGuardians;

    constructor() {
        this.guardians = new MockGuardians(WORMHOLE_GUARDIAN_SET_INDEX, [GUARDIAN_PRIVATE_KEY]);
    }

    async body(
        message: ethers.utils.Result,
        provider: ethers.providers.Provider,
        chain: ChainName,
        txReceipt: ethers.ContractReceipt
    ) {
        const {
            sender: emitterAddress,
            sequence,
            nonce,
            payload: payloadByteslike,
            consistencyLevel,
        } = message;

        const payload = ethers.utils.arrayify(payloadByteslike);
        const body = Buffer.alloc(51 + payload.length);

        const block = await provider.getBlock(txReceipt.blockNumber);
        body.writeUInt32BE(block.timestamp, 0);
        body.writeUInt32BE(nonce, 4);
        body.writeUInt16BE(coalesceChainId(chain), 8);
        body.set(tryNativeToUint8Array(emitterAddress, chain), 10);
        body.writeBigUInt64BE(BigInt(sequence.toString()), 42);
        body.writeUInt8(consistencyLevel, 50);
        body.set(payload, 51);

        return body;
    }

    async observeEvm(
        provider: ethers.providers.Provider,
        chain: ChainName,
        txReceipt: ethers.ContractReceipt
    ) {
        const coreBridgeAddress = CONTRACTS.MAINNET[chain].core!;
        const message = parseEvmEvent(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)"
        );

        const body = await this.body(message, provider, chain, txReceipt);

        return this.guardians.addSignatures(body, [0]);
    }

    async observeManyEvm(
        provider: ethers.providers.Provider,
        chain: ChainName,
        txReceipt: ethers.ContractReceipt
    ) {
        const coreBridgeAddress = CONTRACTS.MAINNET[chain].core!;
        const messages = parseEvmEvents(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)"
        );

        const signedMessages = [];

        for (const message of messages) {
            const body = await this.body(message, provider, chain, txReceipt);
            signedMessages.push(this.guardians.addSignatures(body, [0]));
        }

        return signedMessages;
    }
}
