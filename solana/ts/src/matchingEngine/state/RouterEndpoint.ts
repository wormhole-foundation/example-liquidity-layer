import { PublicKey } from "@solana/web3.js";

export type MessageProtocol = {
    local?: { programId: PublicKey };
    cctp?: { domain: number };
    none?: {};
};

export type EndpointInfo = {
    chain: number;
    address: Array<number>;
    mintRecipient: Array<number>;
    protocol: MessageProtocol;
};

export class RouterEndpoint {
    bump: number;
    info: EndpointInfo;

    constructor(bump: number, info: EndpointInfo) {
        this.bump = bump;
        this.info = info;
    }

    static address(programId: PublicKey, chain: number) {
        const encodedChain = Buffer.alloc(2);
        encodedChain.writeUInt16BE(chain);
        return PublicKey.findProgramAddressSync(
            [Buffer.from("endpoint"), encodedChain],
            programId,
        )[0];
    }
}
