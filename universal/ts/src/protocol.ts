import { Chain, Network } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainAddress,
    CircleAttestation,
    CircleBridge,
    CircleTransferMessage,
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
    // Read methods
    getAuctionGracePeriod(): Promise<number>;
    getAuctionDuration(): Promise<number>;
    getPenaltyBlocks(): Promise<number>;
    getInitialPenaltyBps(): Promise<number>;

    // Admin methods
    registerRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
        cctpDomain: number, // TODO: should be typed?
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
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

    // improves the offer TODO: alias for bid id?
    improveOffer(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offer: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    //this basically fulfills the fast order like sending the cctp message to dst chain
    executeFastOrder(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
    ): AsyncGenerator<UnsignedTransaction<N, C>>;

    // cleans up a fast order by transferring funds/closing account/executing penalty
    settleAuctionComplete(
        sender: AccountAddress<C>,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        finalized: VAA<"FastTransfer:CctpDeposit">,
        cctp: {
            message: CircleBridge.Message;
            attestation: CircleAttestation;
        },
    ): AsyncGenerator<UnsignedTransaction<N, C>>;
}

export interface TokenRouter<N extends Network = Network, C extends Chain = Chain> {
    getInitialAuctionFee(): Promise<bigint>;

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
        circleBridgeMessage: CircleTransferMessage,
        circleAttestation: CircleAttestation,
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
