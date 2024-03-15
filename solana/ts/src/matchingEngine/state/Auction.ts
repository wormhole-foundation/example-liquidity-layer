import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { AuctionParameters } from "./AuctionConfig";

export type AuctionStatus = {
    notStarted?: {};
    active?: {};
    completed?: { slot: BN };
    settled?: {
        baseFee: BN;
        penalty: BN | null;
    };
};

export type AuctionInfo = {
    configId: number;
    vaaSequence: BN;
    sourceChain: number;
    bestOfferToken: PublicKey;
    initialOfferToken: PublicKey;
    startSlot: BN;
    amountIn: BN;
    securityDeposit: BN;
    offerPrice: BN;
    amountOut: BN | null;
};

export class Auction {
    bump: number;
    vaaHash: number[];
    custodyTokenBump: number;
    status: Object;
    info: AuctionInfo | null;

    constructor(
        bump: number,
        vaaHash: number[],
        custodyTokenBump: number,
        status: AuctionStatus,
        info: AuctionInfo | null,
    ) {
        this.bump = bump;
        this.vaaHash = vaaHash;
        this.custodyTokenBump = custodyTokenBump;
        this.status = status;
        this.info = info;
    }

    static address(programId: PublicKey, vaaHash: Array<number> | Buffer | Uint8Array) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("auction"), Buffer.from(vaaHash)],
            programId,
        )[0];
    }
}
