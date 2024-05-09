import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Uint64, writeUint64BE } from "../../common";
import { ChainId } from "@wormhole-foundation/sdk";

export type FastFillInfo = {
    amount: BN;
    redeemer: PublicKey;
};

export type FastFillSeeds = {
    sourceChain: number;
    orderSender: Array<number>;
    sequence: BN;
    bump: number;
};

export class FastFill {
    seeds: FastFillSeeds;
    preparedBy: PublicKey;
    redeemed: boolean;
    info: FastFillInfo;
    redeemerMessage: Buffer;

    constructor(
        seeds: FastFillSeeds,
        preparedBy: PublicKey,
        redeemed: boolean,
        info: FastFillInfo,
        redeemerMessage: Buffer,
    ) {
        this.seeds = seeds;
        this.preparedBy = preparedBy;
        this.redeemed = redeemed;
        this.info = info;
        this.redeemerMessage = redeemerMessage;
    }

    static address(
        programId: PublicKey,
        sourceChain: ChainId,
        orderSender: Array<number>,
        sequence: Uint64,
    ) {
        const encodedSourceChain = Buffer.alloc(2);
        encodedSourceChain.writeUInt16BE(sourceChain);

        const encodedSequence = Buffer.alloc(8);
        writeUint64BE(encodedSequence, sequence);

        return PublicKey.findProgramAddressSync(
            [
                Buffer.from("fast-fill"),
                encodedSourceChain,
                Buffer.from(orderSender),
                encodedSequence,
            ],
            programId,
        )[0];
    }
}
