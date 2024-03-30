import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { MessageTransmitterProgram } from "../cctp";
import { BN } from "@coral-xyz/anchor";

export * from "./messages";
export * from "./state";

export type Uint64 = bigint | BN | number;

export function isUint64(value: Uint64): boolean {
    return (
        typeof value === "bigint" ||
        (typeof value === "object" && value instanceof BN) ||
        typeof value === "number"
    );
}

export function uint64ToBigInt(value: Uint64): bigint {
    if (typeof value === "bigint") {
        return value;
    } else if (typeof value === "number") {
        return BigInt(value);
    } else if (value.byteLength() <= 8) {
        return BigInt(value.toString());
    } else {
        throw new Error("Invalid uint64");
    }
}

export function writeUint64BE(buf: Buffer, value: Uint64, offset?: number) {
    return buf.writeBigUInt64BE(uint64ToBigInt(value), offset);
}

export function uint64ToBN(value: Uint64): BN {
    const buf = Buffer.alloc(8);
    writeUint64BE(buf, value);
    return new BN(buf);
}

export async function reclaimCctpMessageIx(
    messageTransmitter: MessageTransmitterProgram,
    accounts: {
        payer: PublicKey;
        cctpMessage: PublicKey;
    },
    cctpAttestation: Buffer,
): Promise<TransactionInstruction> {
    const { payer, cctpMessage: messageSentEventData } = accounts;

    return messageTransmitter.reclaimEventAccountIx(
        {
            payee: payer,
            messageSentEventData,
        },
        cctpAttestation,
    );
}
