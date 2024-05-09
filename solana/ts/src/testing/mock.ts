import { ChainName, coalesceChainId, parseVaa } from "@certusone/wormhole-sdk";
import { MockEmitter, MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { Connection, Keypair } from "@solana/web3.js";
import { ethers } from "ethers";
import { LiquidityLayerMessage } from "../common";
import { CORE_BRIDGE_PID, GUARDIAN_KEY } from "./consts";
import { postVaa, getBlockTime } from "./utils";
// TODO: return VaaAccount, too
export async function postLiquidityLayerVaa(
    connection: Connection,
    payer: Keypair,
    guardians: MockGuardians,
    foreignEmitterAddress: Array<number>,
    sequence: bigint,
    message: LiquidityLayerMessage | Buffer,
    args: { sourceChain?: ChainName; timestamp?: number } = {},
) {
    let { sourceChain, timestamp } = args;
    sourceChain ??= "ethereum";
    timestamp ??= await getBlockTime(connection);

    const foreignEmitter = new MockEmitter(
        Buffer.from(foreignEmitterAddress).toString("hex"),
        coalesceChainId(sourceChain ?? "ethereum"),
        Number(sequence - 1n),
    );

    const published = foreignEmitter.publishMessage(
        0, // nonce,
        Buffer.isBuffer(message) ? message : message.encode(),
        0, // consistencyLevel
        timestamp,
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

        let offset = 0;
        attestation.set(ethers.utils.arrayify(signature.r), offset);
        offset += 32;
        attestation.set(ethers.utils.arrayify(signature.s), offset);
        offset += 32;

        const recoveryId = signature.recoveryParam;
        attestation.writeUInt8(recoveryId < 27 ? recoveryId + 27 : recoveryId, offset);
        offset += 1;

        return attestation;
    }
}
