import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";

export * from "./evm";

export enum TokenType {
    Unset,
    Native,
    Canonical,
    Cctp,
}

export type PlaceMarketOrderArgs = {
    amountIn: bigint;
    minAmountOut: bigint;
    targetChain: number;
    redeemer: Buffer | Uint8Array;
    redeemerMessage: Buffer | Uint8Array;
    refundAddress: string;
};

export type RouterInfo = {
    endpoint: Buffer | Uint8Array;
    tokenType: TokenType;
    slippage: number;
};

export type OrderResponse = {
    encodedWormholeMessage: Buffer | Uint8Array;
    circleBridgeMessage: Buffer | Uint8Array;
    circleAttestation: Buffer | Uint8Array;
};

export abstract class OrderRouter<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract computeMinAmountOut(
        amountIn: bigint,
        targetChain: number,
        slippage?: number,
        relayerFee?: bigint
    ): Promise<bigint>;

    abstract placeMarketOrder(
        args: PlaceMarketOrderArgs,
        relayerFee?: bigint,
        allowedRelayers?: Buffer[]
    ): Promise<PreparedTransactionType>;

    abstract redeemFill(response: OrderResponse): Promise<PreparedTransactionType>;

    abstract tokenType(): Promise<TokenType>;

    abstract addRouterInfo(chain: number, info: RouterInfo): Promise<PreparedTransactionType>;

    abstract defaultRelayerFee(): Promise<bigint>;

    abstract getRouterInfo(chain: number): Promise<RouterInfo>;

    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
