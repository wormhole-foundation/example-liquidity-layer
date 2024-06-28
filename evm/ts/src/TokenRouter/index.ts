import { deserialize, CircleBridge, VAA } from "@wormhole-foundation/sdk-definitions";
import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";
import { encoding } from "@wormhole-foundation/sdk-base";
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

export type DecodedOrderResponse = {
    vaa: VAA<"FastTransfer:CctpDeposit">;
    cctp: CircleBridge.Attestation;
};
export function decodedOrderResponse(response: OrderResponse): DecodedOrderResponse {
    const [msg] = CircleBridge.deserialize(response.circleBridgeMessage);
    return {
        vaa: deserialize("FastTransfer:CctpDeposit", response.encodedWormholeMessage),
        cctp: {
            message: msg,
            attestation: encoding.hex.encode(response.circleAttestation),
        },
    };
}

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
