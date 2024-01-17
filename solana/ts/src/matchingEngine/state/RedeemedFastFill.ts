import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export class RedeemedFastFill {
    bump: number;
    vaaHash: Array<number>;
    sequence: BN;

    constructor(bump: number, vaaHash: Array<number>, sequence: BN) {
        this.bump = bump;
        this.vaaHash = vaaHash;
        this.sequence = sequence;
    }

    static address(programId: PublicKey, vaaHash: Buffer | Uint8Array) {
        return PublicKey.findProgramAddressSync([Buffer.from("redeemed"), vaaHash], programId)[0];
    }
}
