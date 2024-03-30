import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

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
    encodedPayerSequenceValue.writeBigUInt64BE(BigInt(payerSequenceValue.toString()));
    return PublicKey.findProgramAddressSync(
        [Buffer.from(prefix), payer.toBuffer(), encodedPayerSequenceValue],
        programId,
    )[0];
}
