import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type FastFillInfo = {
    amount: BN;
    sourceChain: number;
    orderSender: Array<number>;
    redeemer: PublicKey;
};

export class FastFill {
    bump: number;
    preparedBy: PublicKey;
    redeemed: boolean;
    info: FastFillInfo;
    redeemerMessage: Buffer;

    constructor(
        bump: number,
        preparedBy: PublicKey,
        redeemed: boolean,
        info: FastFillInfo,
        redeemerMessage: Buffer,
    ) {
        this.bump = bump;
        this.preparedBy = preparedBy;
        this.redeemed = redeemed;
        this.info = info;
        this.redeemerMessage = redeemerMessage;
    }

    static address(programId: PublicKey, auction: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("fast-fill"), Buffer.from(auction.toBuffer())],
            programId,
        )[0];
    }
}
