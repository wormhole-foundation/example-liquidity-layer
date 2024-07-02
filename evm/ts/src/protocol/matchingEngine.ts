import {
    FastTransfer,
    MatchingEngine,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    CircleBridge,
    Contracts,
    UnsignedTransaction,
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
import { IUSDC__factory } from "../types";

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

    async *approveAllowance(sender: AnyEvmAddress, amount: bigint) {
        const from = new EvmAddress(sender).unwrap();
        const tokenContract = IUSDC__factory.connect(this.contracts.cctp.usdcMint, this.provider);

        const allowed = await tokenContract.allowance(from, this.address);
        if (amount > allowed) {
            const txReq = await tokenContract.approve.populateTransaction(this.address, amount);
            yield this.createUnsignedTx(
                { ...txReq, from },
                "MatchingEngine.approveAllowance",
                false,
            );
        }
    }

    async *placeInitialOffer(sender: AnyEvmAddress, order: FastTransfer.Order, offerPrice: bigint) {
        const from = new EvmAddress(sender).unwrap();

        const { amountIn, maxFee } = order.payload;
        yield* this.approveAllowance(sender, amountIn + maxFee);

        const txReq = await this.connect(this.provider).placeInitialBidTx(
            serialize(order),
            offerPrice,
        );

        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.placeInitialOffer");
    }
    async *improveOffer(sender: AnyEvmAddress, order: FastTransfer.Order, offer: bigint) {
        const from = new EvmAddress(sender).unwrap();

        const auctionId = FastTransfer.auctionId(order);

        // TODO: is this the correct amount to request for allowance here
        const { amount, securityDeposit } = await this.liveAuctionInfo(auctionId);
        yield* this.approveAllowance(sender, amount + securityDeposit);

        const txReq = await this.improveBidTx(auctionId, offer);
        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.improveOffer");
    }

    async *executeFastOrder(sender: AnyEvmAddress, vaa: FastTransfer.Order) {
        const from = new EvmAddress(sender).unwrap();
        const txReq = await this.executeFastOrderTx(serialize(vaa));
        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.executeFastOrder");
    }

    async *prepareOrderResponse(
        sender: AnyEvmAddress,
        order: FastTransfer.Order,
        response: FastTransfer.OrderResponse,
    ) {
        throw new Error("Method not implemented.");
    }

    async *settleOrder(
        sender: AnyEvmAddress,
        order: FastTransfer.Order,
        response: FastTransfer.OrderResponse,
    ) {
        const from = new EvmAddress(sender).unwrap();

        const fastVaaBytes = serialize(order);

        const txReq = await (FastTransfer.isFastFill(response)
            ? this.executeFastOrderTx(fastVaaBytes)
            : this.executeSlowOrderAndRedeemTx(fastVaaBytes, {
                  encodedWormholeMessage: serialize(response.vaa),
                  circleBridgeMessage: CircleBridge.serialize(response.cctp!.message),
                  circleAttestation: response.cctp!.attestation!,
              }));

        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.settleOrder");
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
