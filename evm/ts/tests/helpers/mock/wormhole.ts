import { ethers } from "ethers";
import { EvmObserver } from ".";
import { parseEvmEvents, parseEvmEvent } from "../../../src";
import { GUARDIAN_PRIVATE_KEY, WORMHOLE_GUARDIAN_SET_INDEX } from "../consts";
import { Chain, VAA, contracts, toUniversal } from "@wormhole-foundation/sdk";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";
import { tryNativeToUint8Array } from "../utils";

export class GuardianNetwork implements EvmObserver<VAA<"Uint8Array">> {
    guardians: mocks.MockGuardians;

    constructor() {
        this.guardians = new mocks.MockGuardians(WORMHOLE_GUARDIAN_SET_INDEX, [
            GUARDIAN_PRIVATE_KEY,
        ]);
    }

    async body(
        message: ethers.utils.Result,
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ) {
        const { sender: emitterAddress, sequence, nonce, payload, consistencyLevel } = message;

        const foreignEmitter = new mocks.MockEmitter(
            toUniversal(chain, emitterAddress),
            chain,
            sequence,
        );

        const block = await provider.getBlock(txReceipt.blockNumber);
        const published = foreignEmitter.publishMessage(
            nonce,
            Buffer.from(payload.substring(2), "hex"),
            consistencyLevel,
            block.timestamp,
        );

        return published;
    }

    async observeEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ) {
        const coreBridgeAddress = contracts.coreBridge.get("Mainnet", chain)!;
        const message = parseEvmEvent(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)",
        );

        const body = await this.body(message, provider, chain, txReceipt);
        console.log(Buffer.from(body).toString("hex"));
        return this.guardians.addSignatures(body, [0]);
    }

    async observeManyEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ) {
        const coreBridgeAddress = contracts.coreBridge.get("Mainnet", chain)!;
        const messages = parseEvmEvents(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)",
        );

        const signedMessages = [];

        for (const message of messages) {
            const body = await this.body(message, provider, chain, txReceipt);
            signedMessages.push(this.guardians.addSignatures(body, [0]));
        }

        return signedMessages;
    }
}
