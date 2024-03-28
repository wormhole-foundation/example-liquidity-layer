import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { MessageTransmitterProgram } from "../cctp";

export * from "./messages";
export * from "./state";

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
