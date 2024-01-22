import { PublicKey } from "@solana/web3.js";

export class Custodian {
    paused: boolean;
    owner: PublicKey;
    pendingOwner: PublicKey | null;
    ownerAssistant: PublicKey;
    pausedSetBy: PublicKey;

    constructor(
        paused: boolean,
        owner: PublicKey,
        pendingOwner: PublicKey | null,
        ownerAssistant: PublicKey,
        pausedSetBy: PublicKey
    ) {
        this.paused = paused;
        this.owner = owner;
        this.pendingOwner = pendingOwner;
        this.ownerAssistant = ownerAssistant;
        this.pausedSetBy = pausedSetBy;
    }

    static address(programId: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("emitter")], programId)[0];
    }
}
