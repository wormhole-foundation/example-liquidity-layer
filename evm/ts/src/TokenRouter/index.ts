import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";

export * from "./evm";

export type PlaceMarketOrderArgs = {
    amountIn: bigint;
    minAmountOut: bigint;
    targetChain: number;
    redeemer: Buffer | Uint8Array;
    redeemerMessage: Buffer | Uint8Array;
    refundAddress: string;
};

export type PlaceCctpMarketOrderArgs = {
    amountIn: bigint;
    targetChain: number;
    redeemer: Buffer | Uint8Array;
    redeemerMessage: Buffer | Uint8Array;
};

export type OrderResponse = {
    encodedWormholeMessage: Buffer | Uint8Array;
    circleBridgeMessage: Buffer | Uint8Array;
    circleAttestation: Buffer | Uint8Array;
};

export abstract class TokenRouter<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract placeMarketOrder(args: PlaceMarketOrderArgs): Promise<PreparedTransactionType>;

    abstract redeemFill(response: OrderResponse): Promise<PreparedTransactionType>;

    abstract addRouterEndpoint(chain: number, info: string): Promise<PreparedTransactionType>;

    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
