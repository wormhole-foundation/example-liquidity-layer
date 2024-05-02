import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type FillType = {
    unset?: {};
    wormholeCctpDeposit?: {};
    fastFill?: {};
};

export type PreparedFillSeeds = {
    fillSource: PublicKey;
    bump: number;
};

export type PreparedFillInfo = {
    preparedCustodyTokenBump: number;
    preparedBy: PublicKey;
    fillType: FillType;
    sourceChain: number;
    orderSender: Array<number>;
    redeemer: PublicKey;
};

export class PreparedFill {
    seeds: PreparedFillSeeds;
    info: PreparedFillInfo;
    redeemerMessage: Buffer;

    constructor(seeds: PreparedFillSeeds, info: PreparedFillInfo, redeemerMessage: Buffer) {
        this.seeds = seeds;
        this.info = info;
        this.redeemerMessage = redeemerMessage;
    }

    static address(programId: PublicKey, fillSourcet: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("fill"), fillSourcet.toBuffer()],
            programId,
        )[0];
    }
}
