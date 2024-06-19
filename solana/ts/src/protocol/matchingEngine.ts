import {
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
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { Chain, Network, Platform, toChainId } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainsConfig,
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
import {
    AuctionInfo,
    AuctionParameters,
    MatchingEngineProgram,
    ProgramId,
} from "../matchingEngine";

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
            ? new SolanaAddress(tokenAccount).toUniversalAddress().toUint8Array()
            : null;
        const ix = await this.addCctpRouterEndpointIx(
            { ownerOrAssistant },
            {
                chain: toChainId(chain),
                cctpDomain: cctpDomain,
                address: Array.from(router.toUniversalAddress().toUint8Array()),
                mintRecipient: mintRecipient ? Array.from(mintRecipient) : null,
            },
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
            ? new SolanaAddress(tokenAccount).toUniversalAddress().toUint8Array()
            : null;

        const ix = await this.updateCctpRouterEndpointIx(
            { owner },
            {
                chain: toChainId(chain),
                cctpDomain: cctpDomain,
                address: Array.from(router.toUniversalAddress().toUint8Array()),
                mintRecipient: mintRecipient ? Array.from(mintRecipient) : null,
            },
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
        vaa: FastTransfer.VAA,
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

    async *improveOffer(sender: AnySolanaAddress, vaa: FastTransfer.VAA, offer: bigint) {
        const participant = new SolanaAddress(sender).unwrap();
        const auction = this.auctionAddress(keccak256(vaa.hash));

        const ixs = await this.improveOfferIx({ participant, auction }, { offerPrice: offer });

        const transaction = await this.createTx(participant, ixs);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.improveOffer");
    }

    async *executeFastOrder(
        sender: AnySolanaAddress,
        vaa: FastTransfer.VAA,
        participant?: AnySolanaAddress,
    ) {
        if (vaa.payloadLiteral !== "FastTransfer:FastMarketOrder") throw new Error("Invalid VAA");

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
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.improveOffer");
    }

    async *settleAuctionComplete() {
        throw "Not implemented";
    }

    settleAuction(): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }

    getAuctionGracePeriod(): Promise<number> {
        throw new Error("Method not implemented.");
    }
    getAuctionDuration(): Promise<number> {
        throw new Error("Method not implemented.");
    }
    getPenaltyBlocks(): Promise<number> {
        throw new Error("Method not implemented.");
    }
    getInitialPenaltyBps(): Promise<number> {
        throw new Error("Method not implemented.");
    }

    private async createTx(
        payerKey: PublicKey,
        instructions: TransactionInstruction[],
        recentBlockhash?: string,
    ): Promise<VersionedTransaction> {
        if (!recentBlockhash)
            ({ blockhash: recentBlockhash } = await this._connection.getLatestBlockhash());

        const messageV0 = new TransactionMessage({
            payerKey,
            recentBlockhash,
            instructions,
        }).compileToV0Message();
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
