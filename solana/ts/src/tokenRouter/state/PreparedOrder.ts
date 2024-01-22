import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type OrderType = {
    market?: {
        minAmountOut: BN | null;
    };
};

export type PreparedOrderInfo = {
    orderSender: PublicKey;
    payer: PublicKey;
    orderType: OrderType;
    orderToken: PublicKey;
    refundToken: PublicKey;
    amountIn: BN;
    targetChain: number;
    redeemer: Array<number>;
};

export class PreparedOrder {
    info: PreparedOrderInfo;
    redeemerMessage: Buffer;

    constructor(info: PreparedOrderInfo, redeemerMessage: Buffer) {
        this.info = info;
        this.redeemerMessage = redeemerMessage;
    }
}
