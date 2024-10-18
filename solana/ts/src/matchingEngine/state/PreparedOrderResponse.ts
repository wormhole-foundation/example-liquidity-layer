import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { VaaHash } from "../../common";
import { EndpointInfo } from "./RouterEndpoint";

export type PreparedOrderResponseSeeds = {
    fastVaaHash: Array<number>;
    bump: number;
};

export type PreparedOrderResponseInfo = {
    preparedBy: PublicKey;
    baseFeeToken: PublicKey;
    fastVaaTimestamp: number;
    sourceChain: number;
    baseFee: BN;
    initAuctionFee: BN;
    sender: Array<number>;
    redeemer: Array<number>;
    amountIn: BN;
};

export class PreparedOrderResponse {
    seeds: PreparedOrderResponseSeeds;
    info: PreparedOrderResponseInfo;
    toEndpoint: EndpointInfo;
    redeemerMessage: Buffer;

    constructor(
        seeds: PreparedOrderResponseSeeds,
        info: PreparedOrderResponseInfo,
        toEndpoint: EndpointInfo,
        redeemerMessage: Buffer,
    ) {
        this.seeds = seeds;
        this.info = info;
        this.toEndpoint = toEndpoint;
        this.redeemerMessage = redeemerMessage;
    }

    static address(programId: PublicKey, fastVaaHash: VaaHash) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("order-response"), Buffer.from(fastVaaHash)],
            programId,
        )[0];
    }
}
