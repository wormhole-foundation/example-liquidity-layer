import { Connection, PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import {
    ChainId,
    Layout,
    deserializeLayout,
    toChain,
    toChainId,
} from "@wormhole-foundation/sdk-base";
import {
    VAA,
    createVAA,
    deserialize,
    keccak256,
    layoutItems,
} from "@wormhole-foundation/sdk-definitions";
export * from "./spy";

export type EncodedVaa = {
    status: number;
    writeAuthority: PublicKey;
    version: number;
    vaa: VAA<"Uint8Array">;
};

export type EmitterInfo = {
    chain: ChainId;
    address: Array<number>;
    sequence: bigint;
};

const vaaAccountLayout = [
    { name: "discriminator", binary: "bytes", size: 4 },
    { name: "consistencyLevel", binary: "uint", size: 1, endianness: "little" },
    { name: "timestamp", binary: "uint", size: 4, endianness: "little" },
    { name: "signatureSet", binary: "bytes", size: 32 },
    { name: "guardianSetIndex", binary: "uint", size: 4, endianness: "little" },
    { name: "nonce", binary: "uint", size: 4, endianness: "little" },
    { name: "sequence", binary: "uint", size: 8, endianness: "little" },
    { name: "emitterChain", binary: "uint", size: 2, endianness: "little" },
    { name: "emitterAddress", ...layoutItems.universalAddressItem },
    { name: "payload", binary: "bytes", lengthSize: 4, lengthEndianness: "little" },
] as const satisfies Layout;

export class VaaAccount {
    private _encodedVaa?: EncodedVaa;
    private _postedVaaV1?: VAA<"Uint8Array">;

    static async fetch(connection: Connection, addr: PublicKey): Promise<VaaAccount> {
        const accInfo = await connection.getAccountInfo(addr);
        if (accInfo === null) {
            throw new Error("no VAA account info found");
        }
        const { data } = accInfo;

        let offset = 0;
        const disc = data.subarray(offset, (offset += 8));
        if (disc.equals(Uint8Array.from([226, 101, 163, 4, 133, 160, 84, 245]))) {
            const status = data[offset];
            offset += 1;
            const writeAuthority = new PublicKey(data.subarray(offset, (offset += 32)));
            const version = data[offset];
            offset += 1;
            const bufLen = data.readUInt32LE(offset);
            offset += 4;

            const vaa = deserialize("Uint8Array", data.subarray(offset, (offset += bufLen)));
            return new VaaAccount({ encodedVaa: { status, writeAuthority, version, vaa } });
        } else if (disc.subarray(0, (offset -= 4)).equals(Uint8Array.from([118, 97, 97, 1]))) {
            const vaaData = deserializeLayout(vaaAccountLayout, new Uint8Array(data));
            const vaa = createVAA("Uint8Array", {
                timestamp: vaaData.timestamp,
                nonce: vaaData.nonce,
                emitterChain: toChain(vaaData.emitterChain),
                emitterAddress: vaaData.emitterAddress,
                sequence: vaaData.sequence,
                consistencyLevel: vaaData.consistencyLevel,
                payload: vaaData.payload,
                guardianSet: 0,
                signatures: [],
            });
            return new VaaAccount({ postedVaaV1: vaa });
        } else {
            throw new Error("invalid VAA account data");
        }
    }

    vaa(): VAA<"Uint8Array"> {
        if (this._encodedVaa !== undefined) return this._encodedVaa.vaa;
        if (this._postedVaaV1 !== undefined) return this._postedVaaV1;
        throw new Error("impossible: vaa() failed");
    }

    emitterInfo(): EmitterInfo {
        const { emitterChain: chain, emitterAddress: address, sequence } = this.vaa();
        return {
            chain: toChainId(chain),
            address: Array.from(address.toUint8Array()),
            sequence,
        };
    }

    timestamp(): number {
        return this.vaa().timestamp;
    }

    payload(): Buffer {
        return Buffer.from(this.vaa().payload);
    }

    hash(): Uint8Array {
        return this.vaa().hash;
    }

    digest(): Uint8Array {
        return keccak256(this.hash());
    }

    get encodedVaa(): EncodedVaa {
        if (this._encodedVaa === undefined) {
            throw new Error("VaaAccount does not have encodedVaa");
        }
        return this._encodedVaa;
    }

    get postedVaaV1(): VAA<"Uint8Array"> {
        if (this._postedVaaV1 === undefined) {
            throw new Error("VaaAccount does not have postedVaaV1");
        }
        return this._postedVaaV1;
    }

    private constructor(data: { encodedVaa?: EncodedVaa; postedVaaV1?: VAA<"Uint8Array"> }) {
        const { encodedVaa, postedVaaV1 } = data;
        if (encodedVaa !== undefined && postedVaaV1 !== undefined) {
            throw new Error("VaaAccount cannot have both encodedVaa and postedVaaV1");
        }

        this._encodedVaa = encodedVaa;
        this._postedVaaV1 = postedVaaV1;
    }
}
