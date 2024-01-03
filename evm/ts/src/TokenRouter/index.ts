import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";
import { ethers } from "ethers";
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

export abstract class TokenRouter<PreparedTransactionType extends PreparedInstruction> {
    abstract get address(): string;

    abstract placeMarketOrder(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        minAmountOut?: bigint,
        refundAddress?: string
    ): Promise<PreparedTransactionType>;

    abstract placeFastMarketOrder(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        maxFee: bigint,
        deadline: number,
        minAmountOut?: bigint,
        refundAddress?: string
    ): Promise<PreparedTransactionType>;

    abstract redeemFill(response: OrderResponse): Promise<PreparedTransactionType>;

    abstract addRouterEndpoint(
        chain: number,
        info: string,
        domain: number
    ): Promise<PreparedTransactionType>;

    abstract updateFastTransferParameters(
        newParams: FastTransferParameters
    ): Promise<PreparedTransactionType>;

    abstract enableFastTransfer(enable: boolean): Promise<PreparedTransactionType>;

    abstract getInitialAuctionFee(): Promise<ethers.BigNumber>;

    abstract getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult>;
}
