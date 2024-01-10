import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export class PayerSequence {
    bump: number;
    value: BN;

    constructor(bump: number, value: BN) {
        this.bump = bump;
        this.value = value;
    }

    static address(programId: PublicKey, payer: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("seq"), payer.toBuffer()],
            programId
        )[0];
    }
}
