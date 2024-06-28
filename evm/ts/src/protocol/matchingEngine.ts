import {
    MatchingEngine,
    TokenRouter,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network, encoding, toChainId } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    CircleBridge,
    Contracts,
    UnsignedTransaction,
    VAA,
    serialize,
} from "@wormhole-foundation/sdk-definitions";
import {
    AnyEvmAddress,
    EvmAddress,
    EvmChains,
    EvmUnsignedTransaction,
} from "@wormhole-foundation/sdk-evm";
import { ethers } from "ethers";
import { MatchingEngine as _MatchingEngine } from "../MatchingEngine";

export class EvmMatchingEngine<N extends Network, C extends EvmChains>
    extends _MatchingEngine
    implements MatchingEngine<N, C>
{
    constructor(
        readonly network: N,
        readonly chain: C,
        provider: ethers.Provider,
        readonly contracts: Contracts & MatchingEngine.Addresses,
    ) {
        super(provider, contracts.matchingEngine, contracts.cctp.tokenMessenger);
    }
    registerRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C> | undefined,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    updateRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C> | undefined,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    disableRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    setPause(
        sender: AccountAddress<C>,
        pause: boolean,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    setConfiguration(config: {
        enabled: boolean;
        maxAmount: bigint;
        baseFee: bigint;
        initAuctionFee: bigint;
    }): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    placeInitialOffer(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offerPrice: bigint,
        totalDeposit?: bigint | undefined,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    improveOffer(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offer: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    executeFastOrder(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    prepareOrderResponse(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        deposit: VAA<"FastTransfer:CctpDeposit">,
        cctp: CircleBridge.Attestation,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    settleOrder(
        sender: AccountAddress<C>,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        deposit?: VAA<"FastTransfer:CctpDeposit"> | undefined,
        cctp?: CircleBridge.Attestation | undefined,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }

    //async *redeemFill(
    //    sender: AnyEvmAddress,
    //    vaa: VAA<"FastTransfer:CctpDeposit"> | VAA<"FastTransfer:FastFill">,
    //    cctp?: CircleBridge.Attestation,
    //) {
    //    const from = new EvmAddress(sender).unwrap();
    //    const txReq = await this.redeemFillTx({
    //        encodedWormholeMessage: serialize(vaa),
    //        circleBridgeMessage: cctp ? CircleBridge.serialize(cctp.message) : new Uint8Array(),
    //        circleAttestation: cctp ? encoding.hex.decode(cctp.attestation!) : new Uint8Array(),
    //    });
    //    yield this.createUnsignedTx({ ...txReq, from }, "TokenRouter.redeemFill");
    //}

    private createUnsignedTx(
        txReq: ethers.TransactionRequest,
        description: string,
        parallelizable: boolean = false,
    ): UnsignedTransaction<N, C> {
        return new EvmUnsignedTransaction(
            txReq,
            this.network,
            this.chain,
            description,
            parallelizable,
        );
    }
}
