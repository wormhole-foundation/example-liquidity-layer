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
    preparedCustodyTokenBump: number;
    preparedBy: PublicKey;
    fillType: FillType;
    sourceChain: number;
    orderSender: Array<number>;
    redeemer: PublicKey;
    redeemerMessage: Buffer;

    constructor(
        vaaHash: Array<number>,
        bump: number,
        preparedCustodyTokenBump: number,
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
        this.preparedCustodyTokenBump = preparedCustodyTokenBump;
        this.preparedBy = preparedBy;
        this.fillType = fillType;
        this.sourceChain = sourceChain;
        this.orderSender = orderSender;
        this.redeemer = redeemer;
        this.redeemerMessage = redeemerMessage;
    }

    static address(programId: PublicKey, vaaHash: Array<number> | Uint8Array | Buffer) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("fill"), Buffer.from(vaaHash)],
            programId,
        )[0];
    }
}
