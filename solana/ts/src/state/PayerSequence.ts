import { PublicKey } from "@solana/web3.js";

export class PayerSequence {
    static address(programId: PublicKey, payer: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("seq"), payer.toBuffer()],
            programId
        )[0];
    }
}
