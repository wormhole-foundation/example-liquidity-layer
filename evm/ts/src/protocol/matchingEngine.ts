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

    async *placeInitialOffer(
        sender: AnyEvmAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offerPrice: bigint,
        totalDeposit?: bigint | undefined,
    ) {
        const from = new EvmAddress(sender).unwrap();

        yield* this.approveAllowance(sender, totalDeposit!);

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
        const from = new EvmAddress(sender).unwrap();

        const auctionId = FastTransfer.auctionId(vaa);

        // TODO: is this the correct amount to request for allowance here
        const { amount, securityDeposit } = await this.liveAuctionInfo(auctionId);
        yield* this.approveAllowance(sender, amount + securityDeposit);

        const txReq = await this.improveBidTx(auctionId, offer);
        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.improveOffer");
    }

    async *executeFastOrder(sender: AnyEvmAddress, vaa: VAA<"FastTransfer:FastMarketOrder">) {
        const from = new EvmAddress(sender).unwrap();
        const txReq = await this.executeFastOrderTx(serialize(vaa));
        yield this.createUnsignedTx({ ...txReq, from }, "MatchingEngine.executeFastOrder");
    }

    async *prepareOrderResponse(
        sender: AnyEvmAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        deposit: VAA<"FastTransfer:CctpDeposit">,
        cctp: CircleBridge.Attestation,
    ) {
        throw new Error("Method not implemented.");
    }

    async *settleOrder(
        sender: AnyEvmAddress,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        deposit?: VAA<"FastTransfer:CctpDeposit"> | undefined,
        cctp?: CircleBridge.Attestation | undefined,
    ) {
        const from = new EvmAddress(sender).unwrap();

        const fastVaaBytes = serialize(fast);

        const txReq = await (deposit && cctp
            ? this.executeSlowOrderAndRedeemTx(fastVaaBytes, {
                  encodedWormholeMessage: serialize(deposit),
                  circleBridgeMessage: CircleBridge.serialize(cctp.message),
                  circleAttestation: cctp.attestation!,
              })
            : this.executeFastOrderTx(fastVaaBytes));

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
