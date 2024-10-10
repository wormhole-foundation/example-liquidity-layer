import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { Chain } from "@wormhole-foundation/sdk-base";
import { keccak256, secp256k1, serialize, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { LiquidityLayerMessage } from "../common";
import { CORE_BRIDGE_PID, GUARDIAN_KEY } from "./consts";
import { getBlockTime, postVaa } from "./utils";

// TODO: return VaaAccount, too
export async function postLiquidityLayerVaa(
    connection: Connection,
    payer: Keypair,
    guardians: mocks.MockGuardians,
    foreignEmitterAddress: Array<number>,
    sequence: bigint,
    message: LiquidityLayerMessage | Buffer,
    args: { sourceChain?: Chain; timestamp?: number } = {},
) {
    let { sourceChain, timestamp } = args;
    sourceChain ??= "Ethereum";
    timestamp ??= await getBlockTime(connection);

    const foreignEmitter = new mocks.MockEmitter(
        toUniversal(sourceChain, new Uint8Array(foreignEmitterAddress)),
        sourceChain ?? "Ethereum",
        sequence - 1n,
    );

    const published = foreignEmitter.publishMessage(
        0, // nonce,
        Buffer.isBuffer(message) ? message : message.encode(),
        0, // consistencyLevel
        timestamp,
    );
    const vaa = guardians.addSignatures(published, [0]);

    await postVaa(connection, payer, Buffer.from(serialize(vaa)));

    return coreUtils.derivePostedVaaKey(CORE_BRIDGE_PID, Buffer.from(vaa.hash));
}

export class CircleAttester {
    createAttestation(message: Buffer | Uint8Array) {
        const signature = secp256k1.sign(keccak256(message), GUARDIAN_KEY);

        const attestation = Buffer.alloc(65);

        let offset = 0;

        // bigint -> Uint8Array conversion is painful.
        attestation.set(new BN(signature.r.toString()).toBuffer("be", 32), offset);
        offset += 32;

        // bigint -> Uint8Array conversion is painful.
        attestation.set(new BN(signature.s.toString()).toBuffer("be", 32), offset);
        offset += 32;

        const recoveryId = signature.recovery;
        attestation.writeUInt8(recoveryId < 27 ? recoveryId + 27 : recoveryId, offset);
        offset += 1;

        return attestation;
    }
}
