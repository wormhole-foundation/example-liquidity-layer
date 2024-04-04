import { PublicKey } from "@solana/web3.js";
import { Uint64, writeUint64BE } from "..";

export * from "./PayerSequence";

export function emitterAddress(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("emitter")], programId)[0];
}

export function coreMessageAddress(
    programId: PublicKey,
    payer: PublicKey,
    payerSequenceValue: Uint64,
): PublicKey {
    return messageAddress(programId, payer, payerSequenceValue, "core-msg");
}

export function cctpMessageAddress(
    programId: PublicKey,
    payer: PublicKey,
    payerSequenceValue: Uint64,
): PublicKey {
    return messageAddress(programId, payer, payerSequenceValue, "cctp-msg");
}

function messageAddress(
    programId: PublicKey,
    payer: PublicKey,
    payerSequenceValue: Uint64,
    prefix: string,
): PublicKey {
    const encodedPayerSequenceValue = Buffer.alloc(8);
    writeUint64BE(encodedPayerSequenceValue, payerSequenceValue);
    return PublicKey.findProgramAddressSync(
        [Buffer.from(prefix), payer.toBuffer(), encodedPayerSequenceValue],
        programId,
    )[0];
}
