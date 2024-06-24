import { Chain, Network } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainAddress,
    CircleBridge,
    EmptyPlatformMap,
    ProtocolVAA,
    UnsignedTransaction,
    VAA,
} from "@wormhole-foundation/sdk-definitions";
import { FastMarketOrder, MessageName } from "./messages";

export namespace FastTransfer {
    // Add vaas and util methods
    const protocolName = "FastTransfer";
    export type ProtocolName = typeof protocolName;

    /** The VAAs emitted from the TokenBridge protocol */
    export type VAA<PayloadName extends MessageName = MessageName> = ProtocolVAA<
        ProtocolName,
        PayloadName
    >;
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
    export type Addresses = {
        matchingEngine: string;
        coreBridge: string;
        // cctp
        usdcMint: string;
        messageTransmitter: string;
        tokenMessenger: string;
        //
        upgradeManager: string;
    };
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
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offerPrice: bigint,
        totalDeposit?: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    improveOffer(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offer: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    executeFastOrder(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    prepareOrderResponse(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        deposit: VAA<"FastTransfer:CctpDeposit">,
        cctp: CircleBridge.Attestation,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
    settleOrder(
        sender: AccountAddress<C>,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        deposit?: VAA<"FastTransfer:CctpDeposit">,
        cctp?: CircleBridge.Attestation,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
}

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export namespace TokenRouter {
    /** A partially optional copy of FastMarketOrder, to be placed */
    export type OrderRequest = Optional<
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

    export type Addresses = MatchingEngine.Addresses & {
        tokenRouter: string;
    };

    /** The Address or Id of a prepared order */
    export type PreparedOrder<C extends Chain> = AccountAddress<C>;
}

export interface TokenRouter<N extends Network = Network, C extends Chain = Chain> {
    placeMarketOrder(
        sender: AccountAddress<C>,
        order: TokenRouter.OrderRequest | TokenRouter.PreparedOrder<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    redeemFill(
        sender: AccountAddress<C>,
        vaa: FastTransfer.VAA,
        cctp: CircleBridge.Attestation,
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
