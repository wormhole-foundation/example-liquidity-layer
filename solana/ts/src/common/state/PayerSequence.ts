import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export class PayerSequence {
    value: BN;

    constructor(value: BN) {
        this.value = value;
    }

    static address(programId: PublicKey, payer: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("seq"), payer.toBuffer()],
            programId,
        )[0];
    }
}
