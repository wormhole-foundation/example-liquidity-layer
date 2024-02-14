import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { AuctionParameters } from "./AuctionConfig";

export type ProposalAction = {
    none?: {};
    updateAuctionParameters?: {
        id: number;
        parameters: AuctionParameters;
    };
};

export class Proposal {
    id: BN;
    bump: number;
    action: ProposalAction;
    by: PublicKey;
    owner: PublicKey;
    slotProposedAt: BN;
    slotEnactDelay: BN;
    slotEnactedAt: BN | null;
    constructor(
        id: BN,
        bump: number,
        action: ProposalAction,
        by: PublicKey,
        owner: PublicKey,
        slotProposedAt: BN,
        slotEnactDelay: BN,
        slotEnactedAt: BN | null,
    ) {
        this.id = id;
        this.bump = bump;
        this.action = action;
        this.by = by;
        this.owner = owner;
        this.slotProposedAt = slotProposedAt;
        this.slotEnactDelay = slotEnactDelay;
        this.slotEnactedAt = slotEnactedAt;
    }

    static address(programId: PublicKey, nextProposalId: bigint) {
        const encodedProposalId = Buffer.alloc(8);
        encodedProposalId.writeBigUInt64BE(nextProposalId);

        return PublicKey.findProgramAddressSync(
            [Buffer.from("proposal"), encodedProposalId],
            programId,
        )[0];
    }
}
