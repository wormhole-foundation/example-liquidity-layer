import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export class Custodian {
    owner: PublicKey;
    pendingOwner: PublicKey | null;
    ownerAssistant: PublicKey;
    feeRecipientToken: PublicKey;
    auctionConfigId: number;
    nextProposalId: BN;

    constructor(
        owner: PublicKey,
        pendingOwner: PublicKey | null,
        ownerAssistant: PublicKey,
        feeRecipientToken: PublicKey,
        auctionConfigId: number,
        nextProposalId: BN
    ) {
        this.owner = owner;
        this.pendingOwner = pendingOwner;
        this.ownerAssistant = ownerAssistant;
        this.feeRecipientToken = feeRecipientToken;
        this.auctionConfigId = auctionConfigId;
        this.nextProposalId = nextProposalId;
    }

    static address(programId: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("emitter")], programId)[0];
    }
}
