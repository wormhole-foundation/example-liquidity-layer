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
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network, Platform, toChainId } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainsConfig,
    CircleAttestation,
    CircleBridge,
    Contracts,
    UnsignedTransaction,
    VAA,
    keccak256,
} from "@wormhole-foundation/sdk-definitions";
import {
    AnySolanaAddress,
    SolanaAddress,
    SolanaChains,
    SolanaPlatform,
    SolanaTransaction,
    SolanaUnsignedTransaction,
} from "@wormhole-foundation/sdk-solana";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { AuctionParameters, MatchingEngineProgram, ProgramId } from "../matchingEngine";

export interface SolanaMatchingEngineContracts {
    matchingEngine: string;
    usdcMint: string;
}

export class SolanaMatchingEngine<N extends Network, C extends SolanaChains>
    extends MatchingEngineProgram
    implements MatchingEngine<N, C>
{
    constructor(
        readonly _network: N,
        readonly _chain: C,
        readonly _connection: Connection,
        readonly _contracts: Contracts & SolanaMatchingEngineContracts,
    ) {
        super(
            _connection,
            // TODO: BEN
            _contracts.matchingEngine as ProgramId,
            new PublicKey(_contracts.usdcMint),
        );
    }

    static async fromRpc<N extends Network>(
        connection: Connection,
        config: ChainsConfig<N, Platform>,
        contracts: SolanaMatchingEngineContracts,
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
        const transaction = await this.createTx(new SolanaAddress(owner).unwrap(), [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.initialize");
    }

    async *setPause(sender: AnySolanaAddress, pause: boolean) {
        const payer = new SolanaAddress(sender).unwrap();
        const ix = await this.setPauseIx({ ownerOrAssistant: payer }, pause);
        const transaction = await this.createTx(payer, [ix]);
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

        const transaction = await this.createTx(ownerOrAssistant, [ix]);
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

        const transaction = await this.createTx(owner, [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.updateRouter");
    }

    async *disableRouter<RC extends Chain>(sender: AnySolanaAddress, chain: RC) {
        const owner = new SolanaAddress(sender).unwrap();

        const ix = await this.disableRouterEndpointIx({ owner }, toChainId(chain));

        const transaction = await this.createTx(owner, [ix]);
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

    async *placeInitialOffer(
        sender: AnySolanaAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offerPrice: bigint,
        totalDeposit?: bigint,
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        const vaaAddress = coreUtils.derivePostedVaaKey(
            this.coreBridgeProgramId(),
            Buffer.from(vaa.hash),
        );

        const ixs = await this.placeInitialOfferCctpIx(
            { payer, fastVaa: vaaAddress },
            { offerPrice, totalDeposit },
        );

        const transaction = await this.createTx(payer, ixs);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.placeInitialOffer");
    }

    async *improveOffer(
        sender: AnySolanaAddress,
        vaa: VAA<"FastTransfer:FastMarketOrder">,
        offer: bigint,
    ) {
        const participant = new SolanaAddress(sender).unwrap();
        const auction = this.auctionAddress(keccak256(vaa.hash));

        const ixs = await this.improveOfferIx({ participant, auction }, { offerPrice: offer });

        const transaction = await this.createTx(participant, ixs);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.improveOffer");
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

        const fastVaa = coreUtils.derivePostedVaaKey(
            this.coreBridgeProgramId(),
            Buffer.from(vaa.hash),
        );

        const digest = keccak256(vaa.hash);
        const auction = this.auctionAddress(digest);

        // TODO: make sure this has already been done, or do it here
        const reservedSequence = this.reservedFastFillSequenceAddress(digest);

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

        const transaction = await this.createTx(payer, [ix, computeIx]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.executeFastOrder");
    }

    private async _prepareOrderResponseIx(
        sender: AnySolanaAddress,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        finalized: VAA<"FastTransfer:CctpDeposit">,
        cctp: {
            message: CircleBridge.Message;
            attestation: CircleAttestation;
        },
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        const fastVaa = coreUtils.derivePostedVaaKey(
            this.coreBridgeProgramId(),
            Buffer.from(fast.hash),
        );

        const finalizedVaa = coreUtils.derivePostedVaaKey(
            this.coreBridgeProgramId(),
            Buffer.from(finalized.hash),
        );

        const preparedAddress = this.preparedOrderResponseAddress(keccak256(fast.hash));

        try {
            // Check if its already been prepared
            await this.fetchPreparedOrderResponse({ address: preparedAddress });
            return;
        } catch {}

        const ix = await this.prepareOrderResponseCctpIx(
            { payer, fastVaa, finalizedVaa },
            {
                encodedCctpMessage: Buffer.from(CircleBridge.serialize(cctp.message)),
                cctpAttestation: Buffer.from(cctp.attestation, "hex"),
            },
        );

        return ix;
    }

    async *prepareOrderResponse(
        sender: AnySolanaAddress,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        finalized: VAA<"FastTransfer:CctpDeposit">,
        cctp: {
            message: CircleBridge.Message;
            attestation: CircleAttestation;
        },
        lookupTables?: AddressLookupTableAccount[],
    ) {
        const payer = new SolanaAddress(sender).unwrap();
        const ix = await this._prepareOrderResponseIx(sender, fast, finalized, cctp);
        if (ix === undefined) return;

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });

        const transaction = await this.createTx(payer, [ix, computeIx], undefined, lookupTables);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.prepareOrderResponse");
    }

    async *settleOrder(
        sender: AnySolanaAddress,
        fast: VAA<"FastTransfer:FastMarketOrder">,
        finalized?: VAA<"FastTransfer:CctpDeposit">,
        cctp?: {
            message: CircleBridge.Message;
            attestation: CircleAttestation;
        },
        lookupTables?: AddressLookupTableAccount[],
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        // If the finalized VAA and CCTP message/attestation are passed
        // we may try to prepare the order response
        // this yields its own transaction
        const ixs = [];
        if (finalized && cctp) {
            // TODO: how do we decide?
            const combine = true;
            // try to include the prepare order instruction in the same transaction
            if (combine) {
                const ix = await this._prepareOrderResponseIx(sender, fast, finalized, cctp);
                if (ix !== undefined) {
                    ixs.push(ix, ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
                }
            } else {
                yield* this.prepareOrderResponse(sender, fast, finalized, cctp, lookupTables);
            }
        }

        const digest = keccak256(fast.hash);
        const preparedOrderResponse = this.preparedOrderResponseAddress(digest);
        const auction = this.auctionAddress(digest);
        const fastVaa = coreUtils.derivePostedVaaKey(
            this.coreBridgeProgramId(),
            Buffer.from(fast.hash),
        );

        const settleIx = await (async () => {
            if (finalized && !cctp) {
                if (fast.payload.targetChain === "Solana") {
                    const reservedSequence = this.reservedFastFillSequenceAddress(digest);
                    return await this.settleAuctionNoneLocalIx({
                        payer,
                        reservedSequence,
                        preparedOrderResponse,
                        auction,
                    });
                } else {
                    return this.settleAuctionNoneCctpIx(
                        {
                            payer,
                            fastVaa,
                            preparedOrderResponse,
                        },
                        { targetChain: toChainId(fast.payload.targetChain) },
                    );
                }
            } else {
                return await this.settleAuctionCompleteIx({
                    executor: payer,
                    preparedOrderResponse,
                    auction,
                });
            }
        })();

        ixs.push(settleIx);

        const transaction = await this.createTx(payer, ixs, undefined, lookupTables);

        yield this.createUnsignedTx({ transaction }, "MatchingEngine.settleAuctionComplete");
    }

    private async createTx(
        payerKey: PublicKey,
        instructions: TransactionInstruction[],
        recentBlockhash?: string,
        lookupTables?: AddressLookupTableAccount[],
    ): Promise<VersionedTransaction> {
        if (!recentBlockhash)
            ({ blockhash: recentBlockhash } = await this._connection.getLatestBlockhash());

        const messageV0 = new TransactionMessage({
            payerKey,
            recentBlockhash,
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
