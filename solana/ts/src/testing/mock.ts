import { Connection, Keypair } from "@solana/web3.js";
import { FastTransfer, Message } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network } from "@wormhole-foundation/sdk-base";
import { signAndSendWait } from "@wormhole-foundation/sdk-connect";
import { deserialize, serialize, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";
import { SolanaAddress, SolanaSendSigner } from "@wormhole-foundation/sdk-solana";
import { ethers } from "ethers";
import { LiquidityLayerMessage } from "../common";
import { SolanaMatchingEngine } from "../protocol";
import { VaaAccount } from "../wormhole";
import { GUARDIAN_KEY, MOCK_GUARDIANS } from "./consts";
import { getBlockTime } from "./utils";

export class SDKSigner<N extends Network> extends SolanaSendSigner<N, "Solana"> {
    unwrap(): Keypair {
        // @ts-ignore
        return this._keypair;
    }
    connection(): Connection {
        // @ts-ignore
        return this._rpc;
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

export async function createLiquidityLayerVaa(
    connection: Connection,
    foreignEmitterAddress: Array<number>,
    sequence: bigint,
    message: LiquidityLayerMessage | Buffer,
    args: { sourceChain?: Chain; timestamp?: number } = {},
): Promise<FastTransfer.VAA> {
    let { sourceChain, timestamp } = args;
    sourceChain ??= "Ethereum";
    timestamp ??= await getBlockTime(connection);

    const foreignEmitter = new mocks.MockEmitter(
        toUniversal(sourceChain, new Uint8Array(foreignEmitterAddress)),
        sourceChain,
        sequence - 1n,
    );

    const msg = Buffer.isBuffer(message) ? message : message.encode();
    const published = foreignEmitter.publishMessage(0, msg, 0, timestamp);
    const vaa = MOCK_GUARDIANS.addSignatures(published, [0]);

    try {
        return deserialize(FastTransfer.getPayloadDiscriminator(), serialize(vaa));
    } catch {
        // @ts-expect-error -- needed to allow testing of invalid payloads
        return vaa;
    }
}

export async function postAndFetchVaa<N extends Network>(
    signer: SDKSigner<N>,
    engine: SolanaMatchingEngine<N, "Solana">,
    vaa: FastTransfer.VAA,
) {
    const txs = engine.postVaa(signer.address(), vaa);
    await signAndSendWait(txs, signer);

    const address = engine.pdas.postedVaa(vaa);
    const account = await VaaAccount.fetch(signer.connection(), address);

    return { address, account };
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
