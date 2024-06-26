import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";
import { ethers } from "ethers";

export * from "./evm";

export type RedeemParameters = {
    encodedWormholeMessage: Buffer | Uint8Array | string;
    circleBridgeMessage: Buffer | Uint8Array | string;
    circleAttestation: Buffer | Uint8Array | string;
};

export type LiveAuctionData = {
    status: bigint;
    startBlock: bigint;
    highestBidder: string;
    initialBidder: string;
    amount: bigint;
    securityDeposit: bigint;
    bidPrice: bigint;
};

export type RouterEndpoint = {
    router: string | Buffer | Uint8Array;
    mintRecipient: string | Buffer | Uint8Array;
};

export abstract class MatchingEngine<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract addRouterEndpoint(
        chain: number,
        endpoint: RouterEndpoint,
        domain: number,
    ): Promise<PreparedTransactionType>;

    abstract liveAuctionInfo(auctionId: Buffer | Uint8Array): Promise<LiveAuctionData>;

    abstract auctionStatus(auctionId: Buffer | Uint8Array): Promise<bigint>;

    abstract placeInitialBid(
        fastTransferVaa: Buffer | Uint8Array,
        feeBid: bigint,
    ): Promise<PreparedTransactionType>;

    abstract improveBid(
        auctionId: Buffer | Uint8Array,
        feeBid: bigint,
    ): Promise<PreparedTransactionType>;

    abstract executeFastOrder(
        fastTransferVaa: Buffer | Uint8Array,
    ): Promise<PreparedTransactionType>;

    abstract executeSlowOrderAndRedeem(
        fastTransferVaa: Buffer | Uint8Array,
        params: RedeemParameters,
    ): Promise<PreparedTransactionType>;

    abstract calculateDynamicPenalty(
        auctionId?: Buffer | Uint8Array,
        amount?: bigint,
        blocksElapsed?: bigint,
    ): Promise<[ethers.BigNumberish, ethers.BigNumberish]>;

    abstract getAuctionGracePeriod(): Promise<bigint>;

    abstract getAuctionDuration(): Promise<bigint>;

    abstract getPenaltyBlocks(): Promise<bigint>;

    abstract getInitialPenaltyBps(): Promise<bigint>;

    abstract getInitialPenaltyBps(): Promise<bigint>;

    abstract wormhole(): Promise<string>;

    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
