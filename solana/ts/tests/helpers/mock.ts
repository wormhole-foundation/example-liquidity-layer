import {
    ChainName,
    coalesceChainId,
    parseVaa,
    tryNativeToHexString,
} from "@certusone/wormhole-sdk";
import { MockEmitter, MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { Connection, Keypair } from "@solana/web3.js";
import { ethers } from "ethers";
import { LiquidityLayerMessage } from "../../src";
import { CORE_BRIDGE_PID, GUARDIAN_KEY } from "./consts";
import { postVaa } from "./utils";

export async function postLiquidityLayerVaa(
    connection: Connection,
    payer: Keypair,
    guardians: MockGuardians,
    foreignEmitterAddress: Array<number>,
    sequence: bigint,
    message: LiquidityLayerMessage,
    chainName?: ChainName
) {
    const foreignEmitter = new MockEmitter(
        Buffer.from(foreignEmitterAddress).toString("hex"),
        coalesceChainId(chainName ?? "ethereum"),
        Number(sequence)
    );

    const published = foreignEmitter.publishMessage(
        0, // nonce,
        message.encode(),
        0, // consistencyLevel
        12345678 // timestamp
    );
    const vaaBuf = guardians.addSignatures(published, [0]);

    await postVaa(connection, payer, vaaBuf);

    return derivePostedVaaKey(CORE_BRIDGE_PID, parseVaa(vaaBuf).hash);
}

export class CircleAttester {
    attester: ethers.utils.SigningKey;

    constructor() {
        this.attester = new ethers.utils.SigningKey("0x" + GUARDIAN_KEY);
    }

    createAttestation(message: Buffer | Uint8Array) {
        const signature = this.attester.signDigest(ethers.utils.keccak256(message));

        const attestation = Buffer.alloc(65);
        attestation.set(ethers.utils.arrayify(signature.r), 0);
        attestation.set(ethers.utils.arrayify(signature.s), 32);

        const recoveryId = signature.recoveryParam;
        attestation.writeUInt8(recoveryId < 27 ? recoveryId + 27 : recoveryId, 64);

        return attestation;
    }
}
