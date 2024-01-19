import { ChainId } from "@certusone/wormhole-sdk";
import { PublicKey } from "@solana/web3.js";

export class RouterEndpoint {
    bump: number;
    chain: number;
    address: Array<number>;
    mintRecipient: Array<number>;

    constructor(bump: number, chain: number, address: Array<number>, mintRecipient: Array<number>) {
        this.bump = bump;
        this.chain = chain;
        this.address = address;
        this.mintRecipient = mintRecipient;
    }

    static address(programId: PublicKey, chain: ChainId) {
        const encodedChain = Buffer.alloc(2);
        encodedChain.writeUInt16BE(chain);
        return PublicKey.findProgramAddressSync(
            [Buffer.from("endpoint"), encodedChain],
            programId
        )[0];
    }
}
