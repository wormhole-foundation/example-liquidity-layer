import { encoding } from "@wormhole-foundation/sdk-base";
import { CircleBridge, VAA, deserialize, serialize } from "@wormhole-foundation/sdk-definitions";
import { LiquidityLayerTransactionResult, PreparedInstruction } from "..";
import {
    FastTransfer,
    MatchingEngine,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
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

export function encodeOrderResponse(response: FastTransfer.OrderResponse): OrderResponse {
    return FastTransfer.isFastFill(response)
        ? {
              encodedWormholeMessage: serialize(response.vaa),
              circleAttestation: new Uint8Array(),
              circleBridgeMessage: new Uint8Array(),
          }
        : {
              encodedWormholeMessage: serialize(response.vaa),
              circleAttestation: encoding.hex.decode(response.cctp!.attestation!),
              circleBridgeMessage: CircleBridge.serialize(response.cctp!.message),
          };
}
export function decodedOrderResponse(response: OrderResponse): FastTransfer.OrderResponse {
    if (response.circleAttestation.length > 0) {
        const [message] = CircleBridge.deserialize(response.circleBridgeMessage);
        const attestation = encoding.hex.encode(response.circleAttestation, true);
        const vaa = deserialize("FastTransfer:CctpDeposit", response.encodedWormholeMessage);
        return { vaa, cctp: { message, attestation } };
    }
    return { vaa: deserialize("FastTransfer:FastFill", response.encodedWormholeMessage) };
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
