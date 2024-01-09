import { PublicKey } from "@solana/web3.js";

export interface AuctionConfig {
    userPenaltyRewardBps: number;
    initialPenaltyBps: number;
    auctionDuration: number;
    auctionGracePeriod: number;
    auctionPenaltyBlocks: number;
}

export class Custodian {
    bump: number;
    custodyTokenBump: number;
    owner: PublicKey;
    pendingOwner: PublicKey | null;
    ownerAssistant: PublicKey;
    feeRecipient: PublicKey;
    auctionConfig: AuctionConfig;

    constructor(
        bump: number,
        custodyTokenBump: number,
        owner: PublicKey,
        pendingOwner: PublicKey | null,
        ownerAssistant: PublicKey,
        feeRecipient: PublicKey,
        auctionConfig: AuctionConfig
    ) {
        this.bump = bump;
        this.custodyTokenBump = custodyTokenBump;
        this.owner = owner;
        this.pendingOwner = pendingOwner;
        this.ownerAssistant = ownerAssistant;
        this.feeRecipient = feeRecipient;
        this.auctionConfig = auctionConfig;
    }

    static address(programId: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("custodian")], programId)[0];
    }
}
