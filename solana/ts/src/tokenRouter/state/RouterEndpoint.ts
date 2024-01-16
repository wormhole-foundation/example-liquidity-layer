import { ChainId } from "@certusone/wormhole-sdk";
import { PublicKey } from "@solana/web3.js";

export type MessageProtocol = {
    cctp?: { domain: number };
    canonical?: {};
};

export class RouterEndpoint {
    bump: number;
    chain: number;
    address: Array<number>;
    protocol: MessageProtocol;

    constructor(bump: number, chain: number, address: Array<number>, protocol: MessageProtocol) {
        this.bump = bump;
        this.chain = chain;
        this.address = address;
        this.protocol = protocol;
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
