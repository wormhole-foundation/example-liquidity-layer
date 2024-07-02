import {
    AddressLookupTableAccount,
    ComputeBudgetProgram,
    Connection,
    PublicKey,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import {
    FastTransfer,
    MatchingEngine,
    payloadIds,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network, Platform, toChainId } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainsConfig,
    CircleAttestation,
    CircleBridge,
    Contracts,
    VAA,
} from "@wormhole-foundation/sdk-definitions";
import {
    AnySolanaAddress,
    SolanaAddress,
    SolanaChains,
    SolanaPlatform,
    SolanaTransaction,
    SolanaUnsignedTransaction,
} from "@wormhole-foundation/sdk-solana";
import { vaaHash } from "../common";
import { AuctionParameters, MatchingEngineProgram } from "../matchingEngine";
import { SolanaWormholeCore } from "@wormhole-foundation/sdk-solana-core";
import { info } from "console";

export class SolanaMatchingEngine<N extends Network, C extends SolanaChains>
    extends MatchingEngineProgram
    implements MatchingEngine<N, C>
{
    coreBridge: SolanaWormholeCore<N, C>;

    constructor(
        readonly _network: N,
        readonly _chain: C,
        readonly _connection: Connection,
        readonly _contracts: Contracts & MatchingEngine.Addresses,
    ) {
        super(_connection, _contracts);

        this.coreBridge = new SolanaWormholeCore(_network, _chain, _connection, {
            ...this._contracts,
        });
    }

    static async fromRpc<N extends Network>(
        connection: Connection,
        config: ChainsConfig<N, Platform>,
        contracts: MatchingEngine.Addresses,
    ) {
        const [network, chain] = await SolanaPlatform.chainFromRpc(connection);
        const conf = config[chain]!;
        if (conf.network !== network)
            throw new Error(`Network mismatch for chain ${chain}: ${conf.network} != ${network}`);

        return new SolanaMatchingEngine(network as N, chain, connection, {
            ...config[chain]!.contracts,
            ...contracts,
        });
    }

    async *initialize(
        owner: AnySolanaAddress,
        ownerAssistant: AnySolanaAddress,
        feeRecipient: AnySolanaAddress,
        params: AuctionParameters,
        mint?: AnySolanaAddress,
    ) {
        const ix = await this.initializeIx(
            {
                owner: new SolanaAddress(owner).unwrap(),
                ownerAssistant: new SolanaAddress(ownerAssistant).unwrap(),
                feeRecipient: new SolanaAddress(feeRecipient).unwrap(),
                mint: mint ? new SolanaAddress(mint).unwrap() : undefined,
            },
            params,
        );
        const transaction = this.createTx(new SolanaAddress(owner).unwrap(), [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.initialize");
    }

    async *setPause(sender: AnySolanaAddress, pause: boolean) {
        const payer = new SolanaAddress(sender).unwrap();
        const ix = await this.setPauseIx({ ownerOrAssistant: payer }, pause);
        const transaction = this.createTx(payer, [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.setPause");
    }

    async *registerRouter<RC extends Chain>(
        sender: AnySolanaAddress,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AnySolanaAddress,
    ) {
        const ownerOrAssistant = new SolanaAddress(sender).unwrap();
        const mintRecipient = tokenAccount
            ? Array.from(new SolanaAddress(tokenAccount).toUniversalAddress().toUint8Array())
            : null;
        const address = Array.from(router.toUniversalAddress().toUint8Array());

        const ix = await this.addCctpRouterEndpointIx(
            { ownerOrAssistant },
            { chain: toChainId(chain), cctpDomain, address, mintRecipient },
        );

        const transaction = this.createTx(ownerOrAssistant, [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.registerRouter");
    }

    async *updateRouter<RC extends Chain>(
        sender: AnySolanaAddress,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AnySolanaAddress,
    ) {
        const owner = new SolanaAddress(sender).unwrap();
        const mintRecipient = tokenAccount
            ? Array.from(new SolanaAddress(tokenAccount).toUniversalAddress().toUint8Array())
            : null;
        const address = Array.from(router.toUniversalAddress().toUint8Array());
        const ix = await this.updateCctpRouterEndpointIx(
            { owner },
            { chain: toChainId(chain), cctpDomain, address, mintRecipient },
        );

        const transaction = this.createTx(owner, [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.updateRouter");
    }

    async *disableRouter<RC extends Chain>(sender: AnySolanaAddress, chain: RC) {
        const owner = new SolanaAddress(sender).unwrap();

        const ix = await this.disableRouterEndpointIx({ owner }, toChainId(chain));

        const transaction = this.createTx(owner, [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.disableRouter");
    }

    async *setConfiguration(config: {
        enabled: boolean;
        maxAmount: bigint;
        baseFee: bigint;
        initAuctionFee: bigint;
    }) {
        throw new Error("Method not implemented.");
    }

    async *postVaa(sender: AnySolanaAddress, vaa: FastTransfer.VAA) {
        yield* this.coreBridge.postVaa(sender, vaa);
    }

    async *placeInitialOffer(
        sender: AnySolanaAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offerPrice: bigint,
        totalDeposit?: bigint,
    ) {
        // If the VAA has not yet been posted, do so now
        yield* this.postVaa(sender, vaa);

        const payer = new SolanaAddress(sender).unwrap();
        const vaaAddress = this.pdas.postedVaa(vaa);

        const ixs = await this.placeInitialOfferCctpIx(
            { payer, fastVaa: vaaAddress },
            { offerPrice, totalDeposit },
        );

        const transaction = this.createTx(payer, ixs);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.placeInitialOffer");
    }

    async *improveOffer(
        sender: AnySolanaAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offer: bigint,
    ) {
        const participant = new SolanaAddress(sender).unwrap();

        const digest = vaaHash(vaa);
        const auction = this.pdas.auction(digest);

        const ixs = await this.improveOfferIx({ participant, auction }, { offerPrice: offer });

        const transaction = this.createTx(participant, ixs);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.improveOffer");
    }

    async *reserveFastFillSequence() {
        throw new Error("Method not implemented.");
    }

    async *executeFastOrder(
        sender: AnySolanaAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        participant?: AnySolanaAddress,
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        const initialParticipant = participant
            ? new SolanaAddress(participant).unwrap()
            : undefined;

        const fastVaa = this.pdas.postedVaa(vaa);

        const digest = vaaHash(vaa);
        const auction = this.pdas.auction(digest);
        const reservedSequence = this.pdas.reservedFastFillSequence(digest);

        // TODO: make sure this has already been done, or do it here
        // yield* this.reserveFastFillSequence();

        const { targetChain } = vaa.payload;

        const ix =
            targetChain === "Solana"
                ? await this.executeFastOrderLocalIx({
                      payer,
                      fastVaa,
                      auction,
                      reservedSequence,
                      initialParticipant,
                  })
                : await this.executeFastOrderCctpIx(
                      {
                          payer,
                          fastVaa,
                          auction,
                          initialParticipant,
                      },
                      { targetChain: toChainId(targetChain) },
                  );

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 300_000,
        });

        const transaction = this.createTx(payer, [ix, computeIx]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.executeFastOrder");
    }

    private async _prepareOrderResponseIx(
        sender: AnySolanaAddress,
        order: FastTransfer.Order,
        response: FastTransfer.Fill,
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        const fastVaa = this.pdas.postedVaa(order);
        const finalizedVaa = this.pdas.postedVaa(response.vaa);

        const digest = FastTransfer.auctionId(order);
        const preparedAddress = this.pdas.preparedOrderResponse(digest);

        try {
            // Check if its already been prepared
            await this.fetchPreparedOrderResponse({ address: preparedAddress });
            return;
        } catch {}

        const ix = await this.prepareOrderResponseCctpIx(
            { payer, fastVaa, finalizedVaa },
            {
                encodedCctpMessage: Buffer.from(CircleBridge.serialize(response.cctp!.message)),
                cctpAttestation: Buffer.from(response.cctp!.attestation!, "hex"),
            },
        );

        return ix;
    }

    async *prepareOrderResponse(
        sender: AnySolanaAddress,
        order: FastTransfer.Order,
        response: FastTransfer.OrderResponse,
        lookupTables?: AddressLookupTableAccount[],
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        if (FastTransfer.isFastFill(response)) throw "Invalid response type in order prep";

        const ix = await this._prepareOrderResponseIx(sender, order, response);
        if (ix === undefined) return;

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });

        const transaction = this.createTx(payer, [ix, computeIx], lookupTables);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.prepareOrderResponse");
    }

    async *settleOrder(
        sender: AnySolanaAddress,
        order: FastTransfer.Order,
        response: FastTransfer.OrderResponse,
        lookupTables?: AddressLookupTableAccount[],
    ) {
        if (FastTransfer.isFastFill(response)) throw "Invalid response type in order settle";

        const payer = new SolanaAddress(sender).unwrap();

        const ixs = [];
        if (response.cctp) {
            const ix = await this._prepareOrderResponseIx(sender, order, response);
            if (ix !== undefined) {
                ixs.push(ix, ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
            }
        }

        const fastVaa = this.pdas.postedVaa(order);

        const digest = FastTransfer.auctionId(order);
        const preparedOrderResponse = this.pdas.preparedOrderResponse(digest);
        const auction = this.pdas.auction(digest);

        let bestOfferToken;
        let activeAuction = false;
        try {
            const { info } = await this.fetchAuction({ address: auction });
            if (!info) throw "No auction";
            activeAuction = true;
            bestOfferToken = info.bestOfferToken;
        } catch {}

        const settleIx = await (async () => {
            if (activeAuction) {
                return await this.settleAuctionCompleteIx({
                    executor: payer,
                    preparedOrderResponse,
                    auction,
                    bestOfferToken,
                });
            }

            // no auction

            if (order.payload.targetChain === "Solana") {
                const reservedSequence = this.pdas.reservedFastFillSequence(digest);
                return await this.settleAuctionNoneLocalIx({
                    payer,
                    reservedSequence,
                    preparedOrderResponse,
                    auction,
                });
            } else {
                return await this.settleAuctionNoneCctpIx(
                    { payer, fastVaa, preparedOrderResponse, auction },
                    { targetChain: toChainId(order.payload.targetChain) },
                );
            }
        })();

        ixs.push(settleIx);

        const transaction = this.createTx(payer, ixs, lookupTables);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.settleAuctionComplete");
    }

    private createTx(
        payerKey: PublicKey,
        instructions: TransactionInstruction[],
        lookupTables?: AddressLookupTableAccount[],
    ): VersionedTransaction {
        const messageV0 = new TransactionMessage({
            payerKey,
            recentBlockhash: "",
            instructions,
        }).compileToV0Message(lookupTables);
        return new VersionedTransaction(messageV0);
    }

    private createUnsignedTx(
        txReq: SolanaTransaction,
        description: string,
        parallelizable: boolean = false,
    ): SolanaUnsignedTransaction<N, C> {
        return new SolanaUnsignedTransaction(
            txReq,
            this._network,
            this._chain,
            description,
            parallelizable,
        );
    }
}
