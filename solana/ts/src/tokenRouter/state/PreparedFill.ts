import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type FillType = {
    unset?: {};
    wormholeCctpDeposit?: {};
    fastFill?: {};
};

export class PreparedFill {
    vaaHash: Array<number>;
    bump: number;
    redeemer: PublicKey;
    preparedBy: PublicKey;
    fillType: FillType;
    amount: BN;
    sourceChain: number;
    orderSender: Array<number>;
    redeemerMessage: Buffer;

    constructor(
        vaaHash: Array<number>,
        bump: number,
        redeemer: PublicKey,
        preparedBy: PublicKey,
        fillType: FillType,
        amount: BN,
        sourceChain: number,
        orderSender: Array<number>,
        redeemerMessage: Buffer,
    ) {
        this.vaaHash = vaaHash;
        this.bump = bump;
        this.redeemer = redeemer;
        this.preparedBy = preparedBy;
        this.fillType = fillType;
        this.amount = amount;
        this.sourceChain = sourceChain;
        this.orderSender = orderSender;
        this.redeemerMessage = redeemerMessage;
    }

    static address(programId: PublicKey, vaaHash: Array<number> | Uint8Array | Buffer) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("fill"), Buffer.from(vaaHash)],
            programId,
        )[0];
    }
}
