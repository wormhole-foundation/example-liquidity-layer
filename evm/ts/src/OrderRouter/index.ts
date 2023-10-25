import {ChainType, LiquidityLayerMessage, PreparedInstruction} from "..";

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

export type LiquidityLayerWormholeMessage = {
    emitterAddress: Buffer | Uint8Array;
    sequence: bigint;
    nonce: number;
    consistencyLevel: number;
    message: LiquidityLayerMessage;
};

export type OrderRouterTransactionResult = {
    wormhole: LiquidityLayerWormholeMessage;
    circleMessage?: Buffer;
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

    abstract getTransactionResults(txHash: string): Promise<OrderRouterTransactionResult>;
}
