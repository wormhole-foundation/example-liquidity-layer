import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { FastFillSeeds } from "./FastFill";
import { VaaHash } from "../../common";

export type FastFillInfo = {
    amount: BN;
    redeemer: PublicKey;
};

export type ReservedFastFillSequenceSeeds = {
    fastVaaHash: Array<number>;
    bump: number;
};

export class ReservedFastFillSequence {
    seeds: ReservedFastFillSequenceSeeds;
    beneficiary: PublicKey;
    fastFillSeeds: FastFillSeeds;

    constructor(
        seeds: ReservedFastFillSequenceSeeds,
        beneficiary: PublicKey,
        fastFillSeeds: FastFillSeeds,
    ) {
        this.seeds = seeds;
        this.beneficiary = beneficiary;
        this.fastFillSeeds = fastFillSeeds;
    }

    static address(programId: PublicKey, fastVaaHash: VaaHash) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("reserved-fast-fill-sequence"), Buffer.from(fastVaaHash)],
            programId,
        )[0];
    }
}
