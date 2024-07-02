import { Chain, Network } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainAddress,
    CircleBridge,
    Contracts,
    EmptyPlatformMap,
    ProtocolVAA,
    UnsignedTransaction,
    VAA,
    keccak256,
    payloadDiscriminator,
} from "@wormhole-foundation/sdk-definitions";
import { FastMarketOrder, MessageName, messageNames } from "./messages";

// Utility types to allow re-use of the same type while making some
// fields optional or required
type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };
type WithOptional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export namespace FastTransfer {
    const protocolName = "FastTransfer";
    export type ProtocolName = typeof protocolName;

    /** The VAAs emitted from the TokenBridge protocol */
    export type VAA<PayloadName extends MessageName = MessageName> = ProtocolVAA<
        ProtocolName,
        PayloadName
    >;

    /** Addresses for FastTransfer protocol contracts */
    export type Addresses = Contracts & {
        matchingEngine?: string;
        tokenRouter?: string;
        upgradeManager?: string;
        // Add usdcMint to cctp contracts, mostly for testing
        cctp?: Contracts["cctp"] & { usdcMint: string };
    };

    export type Order = VAA<"FastMarketOrder">;
    export const auctionId = (vaa: Order) => keccak256(vaa.hash);

    export type Fill = { vaa: FastTransfer.VAA<"CctpDeposit">; cctp?: CircleBridge.Attestation };
    export type FastFill = { vaa: FastTransfer.VAA<"FastFill"> };

    export type OrderResponse = Fill | FastFill;
    export const isFastFill = (response: OrderResponse): response is FastFill =>
        response.vaa.payloadName === "FastFill";

    export const getPayloadDiscriminator = () => payloadDiscriminator([protocolName, messageNames]);
}

export interface FastTransfer<N extends Network, C extends Chain> {
    // TODO: more arguments probably necessary here
    transfer(
        sender: AccountAddress<C>,
        recipient: ChainAddress<Chain>,
        token: AccountAddress<C>,
        // TODO: src/dst tokens?
        amount: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    // redeem?
}

export namespace MatchingEngine {
    /** Contract addresses required for MatchingEngine */
    export type Addresses = WithRequired<
        FastTransfer.Addresses,
        "matchingEngine" | "coreBridge" | "cctp"
    >;
}

// matching engine: this is only on solana and where the auctions happen
export interface MatchingEngine<N extends Network, C extends Chain> {
    // Admin methods
    registerRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
        cctpDomain: number, // TODO: should be typed?
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    updateRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
        cctpDomain: number, // TODO: should be typed?
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    disableRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    setPause(sender: AccountAddress<C>, pause: boolean): AsyncGenerator<UnsignedTransaction<N, C>>;
    setConfiguration(config: {
        enabled: boolean;
        maxAmount: bigint;
        baseFee: bigint;
        initAuctionFee: bigint;
    }): AsyncGenerator<UnsignedTransaction<N, C>>;

    // Standard usage

    // the first offer for the fast transfer and inits an auction
    placeInitialOffer(
        sender: AccountAddress<C>,
        vaa: FastTransfer.Order,
        offerPrice: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    // improve the offer below previous offers
    improveOffer(
        sender: AccountAddress<C>,
        order: FastTransfer.Order,
        offer: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    // Order
    executeFastOrder(
        sender: AccountAddress<C>,
        order: FastTransfer.Order,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    prepareOrderResponse(
        sender: AccountAddress<C>,
        order: FastTransfer.Order,
        response: FastTransfer.OrderResponse,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    settleOrder(
        sender: AccountAddress<C>,
        order: FastTransfer.Order,
        response: FastTransfer.OrderResponse,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
}

export namespace TokenRouter {
    /** A partially optional copy of FastMarketOrder, to be placed */
    export type OrderRequest = WithOptional<
        FastMarketOrder,
        | "sender"
        | "deadline"
        | "refundAddress"
        | "minAmountOut"
        | "redeemerMessage"
        | "initAuctionFee"
        | "maxFee"
    >;

    export function isOrderRequest(value: any): value is OrderRequest {
        return (
            typeof value === "object" &&
            <FastMarketOrder>value.amountIn !== undefined &&
            <FastMarketOrder>value.redeemer !== undefined &&
            <FastMarketOrder>value.targetChain !== undefined
        );
    }

    /** Contract addresses required for TokenRouter */
    export type Addresses = WithRequired<MatchingEngine.Addresses, "tokenRouter">;

    /** The Address or Id of a prepared order */
    export type PreparedOrder<C extends Chain> = AccountAddress<C>;
}

export interface TokenRouter<N extends Network, C extends Chain> {
    placeMarketOrder(
        sender: AccountAddress<C>,
        order: TokenRouter.OrderRequest | TokenRouter.PreparedOrder<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    redeemFill(
        sender: AccountAddress<C>,
        orderResponse: FastTransfer.OrderResponse,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
}

declare module "@wormhole-foundation/sdk-definitions" {
    export namespace WormholeRegistry {
        interface ProtocolToInterfaceMapping<N, C> {
            FastTransfer: FastTransfer<N, C>;
        }
        interface ProtocolToPlatformMapping {
            FastTransfer: EmptyPlatformMap<"FastTransfer">;
        }
    }
}
