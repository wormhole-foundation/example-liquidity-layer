import { ethers } from "ethers-v5";
import { EvmObserver } from ".";
import { parseEvmEvents, parseEvmEvent } from "../..";
import { GUARDIAN_PRIVATE_KEY, WORMHOLE_GUARDIAN_SET_INDEX } from "../consts";
import { Chain, contracts } from "@wormhole-foundation/sdk-base";
import { serialize, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";

export class GuardianNetwork implements EvmObserver<Uint8Array> {
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
        return serialize(this.guardians.addSignatures(body, [0]));
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

        return signedMessages.map((vaa) => serialize(vaa));
    }
}
