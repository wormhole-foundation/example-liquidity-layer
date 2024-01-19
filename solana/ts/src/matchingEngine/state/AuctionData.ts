import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export class AuctionData {
    bump: number;
    vaaHash: number[];
    status: Object;
    bestOfferToken: PublicKey;
    initialOfferToken: PublicKey;
    startSlot: BN;
    amount: BN;
    securityDeposit: BN;
    offerPrice: BN;

    constructor(
        bump: number,
        vaaHash: number[],
        status: Object,
        bestOfferToken: PublicKey,
        initialOfferToken: PublicKey,
        start_slot: BN,
        amount: BN,
        security_deposit: BN,
        offer_price: BN
    ) {
        this.bump = bump;
        this.vaaHash = vaaHash;
        this.status = status;
        this.bestOfferToken = bestOfferToken;
        this.initialOfferToken = initialOfferToken;
        this.startSlot = start_slot;
        this.amount = amount;
        this.securityDeposit = security_deposit;
        this.offerPrice = offer_price;
    }

    static address(programId: PublicKey, vaaHash: Array<number> | Buffer | Uint8Array) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("auction"), Buffer.from(vaaHash)],
            programId
        )[0];
    }
}
