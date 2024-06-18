import {
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
} from "@wormhole-foundation/sdk-definitions";
import {
    SolanaAddress,
    SolanaChains,
    SolanaPlatform,
    SolanaTransaction,
    SolanaUnsignedTransaction,
} from "@wormhole-foundation/sdk-solana";
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
        owner: AccountAddress<C>,
        ownerAssistant: AccountAddress<C>,
        feeRecipient: AccountAddress<C>,
        params: AuctionParameters,
        mint?: AccountAddress<C>,
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

    async *setPause(sender: AccountAddress<C>, pause: boolean) {
        const payer = new SolanaAddress(sender).unwrap();
        const ix = await this.setPauseIx({ ownerOrAssistant: payer }, pause);
        const transaction = await this.createTx(payer, [ix]);
        yield this.createUnsignedTx({ transaction }, "MatchingEngine.setPause");
    }

    async *registerRouter<RC extends Chain>(
        sender: AccountAddress<C>,
        chain: RC,
        cctpDomain: number,
        router: AccountAddress<RC>,
        tokenAccount?: AccountAddress<C>,
    ) {
        const ownerOrAssistant = new SolanaAddress(sender).unwrap();
        const mintRecipient = tokenAccount?.toUniversalAddress().toUint8Array() ?? null;
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

    async *setConfiguration(config: {
        enabled: boolean;
        maxAmount: bigint;
        baseFee: bigint;
        initAuctionFee: bigint;
    }) {
        throw new Error("Method not implemented.");
    }

    async *placeInitialOffer(
        sender: AccountAddress<C>,
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
        yield this.createUnsignedTx(
            { transaction: transaction },
            "MatchingEngine.placeInitialOffer",
        );
    }

    improveOffer(
        id: Uint8Array,
        bid: bigint,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    executeFastOrder(
        vaa: FastTransfer.VAA,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    settleAuctionComplete(): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
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
    getInitialPenaltyBps(): Promise<number>;
    getInitialPenaltyBps(): Promise<number>;
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
