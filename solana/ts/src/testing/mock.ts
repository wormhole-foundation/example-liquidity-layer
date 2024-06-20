import { Connection, Keypair } from "@solana/web3.js";
import { Chain, Network } from "@wormhole-foundation/sdk-base";
import { SignAndSendSigner, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";
import { SolanaAddress, SolanaSendSigner } from "@wormhole-foundation/sdk-solana";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { ethers } from "ethers";
import { LiquidityLayerMessage } from "../common";
import { VaaAccount } from "../wormhole";
import { CORE_BRIDGE_PID, GUARDIAN_KEY, MOCK_GUARDIANS } from "./consts";
import { getBlockTime, postVaa } from "./utils";

export class SDKSigner<N extends Network> extends SolanaSendSigner<N, "Solana"> {
    unwrap(): Keypair {
        // @ts-ignore
        return this._keypair;
    }
}

export function getSdkSigner<N extends Network>(
    connection: Connection,
    key: Keypair,
    debug: boolean = false,
): { signer: SDKSigner<N>; address: SolanaAddress } {
    const signer = new SDKSigner(connection, "Solana", key, debug, {});
    const address = new SolanaAddress(key.publicKey);
    return { signer, address };
}

export function unwrapSigners(signers: SDKSigner<Network>[]): Keypair[] {
    return signers.map((signer) => signer.unwrap());
}

export async function postLiquidityLayerVaav2(
    connection: Connection,
    payer: Keypair | SignAndSendSigner<Network, "Solana">,
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

    const vaa = MOCK_GUARDIANS.addSignatures(published, [0]);

    const { address } = await postVaa(connection, payer, vaa);
    const account = await VaaAccount.fetch(connection, address);

    return { address, account };
}

// TODO: Replace any invocations of this function with postLiquidityLayerVaav2
// then rename back to postLiquidityLayerVaa
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

    await postVaa(connection, payer, vaa);

    return coreUtils.derivePostedVaaKey(CORE_BRIDGE_PID, Buffer.from(vaa.hash));
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
