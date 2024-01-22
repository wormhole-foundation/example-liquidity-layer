import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export class PreparedSlowOrder {
    bump: number;
    preparedBy: PublicKey;
    fastVaaHash: Array<number>;
    sourceChain: number;
    baseFee: BN;

    constructor(
        bump: number,
        preparedBy: PublicKey,
        fastVaaHash: Array<number>,
        sourceChain: number,
        baseFee: BN
    ) {
        this.bump = bump;
        this.preparedBy = preparedBy;
        this.fastVaaHash = fastVaaHash;
        this.sourceChain = sourceChain;
        this.baseFee = baseFee;
    }

    static address(programId: PublicKey, payer: PublicKey, fastVaaHash: Array<number>) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("prepared"), payer.toBuffer(), Buffer.from(fastVaaHash)],
            programId
        )[0];
    }
}