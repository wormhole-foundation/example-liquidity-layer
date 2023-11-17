import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";

export * from "./evm";

export type AuctionConfig = {
    userPenaltyRewardBps: number;
    initialPenaltyBps: number;
    auctionDuration: number;
    auctionGracePeriod: number;
    penaltyBlocks: number;
};

export abstract class MatchingEngine<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract addRouterEndpoint(chain: number, router: string): Promise<PreparedTransactionType>;

    abstract setAuctionConfig(config: AuctionConfig): Promise<PreparedTransactionType>;

    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
