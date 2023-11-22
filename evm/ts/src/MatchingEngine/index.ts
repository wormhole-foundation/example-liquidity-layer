import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";
import { ethers } from "ethers";

export * from "./evm";

export type RedeemParameters = {
    encodedWormholeMessage: Buffer | Uint8Array;
    circleBridgeMessage: Buffer | Uint8Array;
    circleAttestation: Buffer | Uint8Array;
};

export type AuctionConfig = {
    userPenaltyRewardBps: number;
    initialPenaltyBps: number;
    auctionDuration: number;
    auctionGracePeriod: number;
    penaltyBlocks: number;
};

export type LiveAuctionData = {
    status: number;
    startBlock: bigint | ethers.BigNumberish;
    highestBidder: string;
    initialBidder: string;
    amount: bigint | ethers.BigNumberish;
    securityDeposit: bigint | ethers.BigNumberish;
    bidPrice: bigint | ethers.BigNumberish;
};

export abstract class MatchingEngine<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract addRouterEndpoint(chain: number, router: string): Promise<PreparedTransactionType>;

    abstract setAuctionConfig(config: AuctionConfig): Promise<PreparedTransactionType>;

    abstract liveAuctionInfo(auctionId: Buffer | Uint8Array): Promise<LiveAuctionData>;

    abstract placeInitialBid(
        fastTransferVaa: Buffer | Uint8Array,
        feeBid: bigint
    ): Promise<PreparedTransactionType>;

    abstract improveBid(
        auctionId: Buffer | Uint8Array,
        feeBid: bigint
    ): Promise<PreparedTransactionType>;

    abstract executeFastOrder(
        fastTransferVaa: Buffer | Uint8Array
    ): Promise<PreparedTransactionType>;

    abstract executeSlowOrderAndRedeem(
        fastTransferVaa: Buffer | Uint8Array,
        params: RedeemParameters
    ): Promise<PreparedTransactionType>;

    abstract calculateDynamicPenalty(
        auctionId?: Buffer | Uint8Array,
        amount?: bigint,
        blocksElapsed?: bigint
    ): Promise<[ethers.BigNumberish, ethers.BigNumberish]>;

    abstract getAuctionGracePeriod(): Promise<number>;

    abstract getAuctionConfig(): Promise<AuctionConfig>;

    abstract wormhole(): Promise<string>;

    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
