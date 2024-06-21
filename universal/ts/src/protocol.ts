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
import { MessageName } from "./messages";

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

export interface TokenRouter<N extends Network = Network, C extends Chain = Chain> {
    placeMarketOrder(
        amount: bigint,
        redeemer: ChainAddress<Chain>,
        redeemerMessage: Uint8Array,
        minAmountOut?: bigint,
        refundAddress?: AccountAddress<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    placeFastMarketOrder<RC extends Chain>(
        amount: bigint,
        chain: Chain,
        redeemer: AccountAddress<RC>,
        redeemerMessage: Uint8Array,
        maxFee: bigint,
        deadline: number,
        minAmountOut?: bigint,
        refundAddress?: string,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    redeemFill(
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
