import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export class UpgradeReceipt {
    bump: number;
    owner: PublicKey;
    buffer: PublicKey;
    slot: BN;

    constructor(bump: number, owner: PublicKey, buffer: PublicKey, slot: BN) {
        this.bump = bump;
        this.owner = owner;
        this.buffer = buffer;
        this.slot = slot;
    }

    static address(programId: PublicKey, otherProgram: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("receipt"), otherProgram.toBuffer()],
            programId,
        )[0];
    }
}
