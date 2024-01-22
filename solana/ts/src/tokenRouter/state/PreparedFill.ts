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
    payer: PublicKey;
    fillType: FillType;
    sourceChain: number;
    orderSender: Array<number>;
    amount: BN;

    constructor(
        vaaHash: Array<number>,
        bump: number,
        redeemer: PublicKey,
        payer: PublicKey,
        fillType: FillType,
        sourceChain: number,
        orderSender: Array<number>,
        amount: BN
    ) {
        this.vaaHash = vaaHash;
        this.bump = bump;
        this.redeemer = redeemer;
        this.payer = payer;
        this.fillType = fillType;
        this.sourceChain = sourceChain;
        this.orderSender = orderSender;
        this.amount = amount;
    }

    static address(programId: PublicKey, vaaHash: Array<number> | Uint8Array | Buffer) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("fill"), Buffer.from(vaaHash)],
            programId
        )[0];
    }
}
