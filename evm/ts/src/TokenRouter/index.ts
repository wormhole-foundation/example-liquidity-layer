import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";
export * from "./evm";

export type FastTransferParameters = {
    enabled: boolean;
    maxAmount: bigint;
    baseFee: bigint;
    initAuctionFee: bigint;
};

export type OrderResponse = {
    encodedWormholeMessage: Buffer | Uint8Array;
    circleBridgeMessage: Buffer | Uint8Array;
    circleAttestation: Buffer | Uint8Array;
};

export type Endpoint = {
    router: string | Buffer | Uint8Array;
    mintRecipient: string | Buffer | Uint8Array;
};

export abstract class AbstractTokenRouter<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract placeMarketOrderTx(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        minAmountOut?: bigint,
        refundAddress?: string,
    ): Promise<PreparedTransactionType>;

    abstract placeFastMarketOrderTx(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        maxFee: bigint,
        deadline: number,
        minAmountOut?: bigint,
        refundAddress?: string,
    ): Promise<PreparedTransactionType>;

    abstract redeemFillTx(response: OrderResponse): Promise<PreparedTransactionType>;

    abstract addRouterEndpointTx(
        chain: number,
        endpoint: Endpoint,
        domain: number,
    ): Promise<PreparedTransactionType>;

    abstract updateFastTransferParametersTx(
        newParams: FastTransferParameters,
    ): Promise<PreparedTransactionType>;

    abstract enableFastTransferTx(enable: boolean): Promise<PreparedTransactionType>;

    abstract getInitialAuctionFee(): Promise<bigint>;
    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
