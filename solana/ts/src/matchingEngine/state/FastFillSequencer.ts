import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type FastFillSequencerSeeds = {
    sourceChain: number;
    sender: Array<number>;
    bump: number;
};

export class FastFillSequencer {
    seeds: FastFillSequencerSeeds;
    nextSequence: BN;

    constructor(seeds: FastFillSequencerSeeds, nextSequence: BN) {
        this.seeds = seeds;
        this.nextSequence = nextSequence;
    }

    static address(programId: PublicKey, sourceChain: wormholeSdk.ChainId, sender: Array<number>) {
        const encodedSourceChain = Buffer.alloc(2);
        encodedSourceChain.writeUInt16BE(sourceChain);

        return PublicKey.findProgramAddressSync(
            [Buffer.from("fast-fill-sequencer"), encodedSourceChain, Buffer.from(sender)],
            programId,
        )[0];
    }
}
