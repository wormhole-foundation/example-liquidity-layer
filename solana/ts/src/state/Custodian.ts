import { PublicKey } from "@solana/web3.js";

export class Custodian {
    bump: number;
    paused: boolean;
    owner: PublicKey;
    pendingOwner: PublicKey | null;
    ownerAssistant: PublicKey;
    pausedSetBy: PublicKey;

    constructor(
        bump: number,
        paused: boolean,
        owner: PublicKey,
        pendingOwner: PublicKey | null,
        ownerAssistant: PublicKey,
        pausedSetBy: PublicKey
    ) {
        this.bump = bump;
        this.paused = paused;
        this.owner = owner;
        this.pendingOwner = pendingOwner;
        this.ownerAssistant = ownerAssistant;
        this.pausedSetBy = pausedSetBy;
    }

    static address(programId: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("custodian")], programId)[0];
    }
}
