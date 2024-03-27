import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type UpgradeStatus = {
    none?: {};
    uncommitted?: {
        buffer: PublicKey;
        slot: BN;
    };
};

export class UpgradeReceipt {
    bump: number;
    programDataBump: number;
    status: UpgradeStatus;

    constructor(bump: number, programDataBump: number, status: UpgradeStatus) {
        this.bump = bump;
        this.programDataBump = programDataBump;
        this.status = status;
    }

    static address(programId: PublicKey, otherProgram: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("receipt"), otherProgram.toBuffer()],
            programId,
        )[0];
    }
}
