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
    async *registerRouter<RC extends Chain>(
        sender: AnyEvmAddress,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C> | undefined,
    ) {
        throw new Error("Method not implemented.");
    }
    async *updateRouter<RC extends Chain>(
        sender: AnyEvmAddress,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C> | undefined,
    ) {
        throw new Error("Method not implemented.");
    }
    async *disableRouter<RC extends Chain>(sender: AnyEvmAddress, chain: RC) {
        throw new Error("Method not implemented.");
    }
    async *setPause(sender: AnyEvmAddress, pause: boolean) {
        throw new Error("Method not implemented.");
    }
    async *setConfiguration(config: {
        enabled: boolean;
        maxAmount: bigint;
        baseFee: bigint;
        initAuctionFee: bigint;
    }) {
        throw new Error("Method not implemented.");
    }
    async *placeInitialOffer(
        sender: AnyEvmAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offerPrice: bigint,
        totalDeposit?: bigint | undefined,
    ) {
        const from = new EvmAddress(sender).unwrap();
        const txReq = await this.connect(this.provider).placeInitialBidTx(
            serialize(vaa),
            offerPrice,
        );

        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.placeInitialOffer");
    }
    async *improveOffer(
        sender: AnyEvmAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offer: bigint,
    ) {
        throw new Error("Method not implemented.");
    }
    async *executeFastOrder(sender: AnyEvmAddress, vaa: VAA<"FastTransfer:FastMarketOrder">) {
        throw new Error("Method not implemented.");
    }
    async *prepareOrderResponse(
        sender: AccountAddress<C>,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        deposit: VAA<"FastTransfer:CctpDeposit">,
        cctp: CircleBridge.Attestation,
    ) {
        throw new Error("Method not implemented.");
    }
    async *settleOrder(
        sender: AccountAddress<C>,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        deposit?: VAA<"FastTransfer:CctpDeposit"> | undefined,
        cctp?: CircleBridge.Attestation | undefined,
    ) {
        throw new Error("Method not implemented.");
    }

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
