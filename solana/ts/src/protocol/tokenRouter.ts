import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableAccount,
    Connection,
    Keypair,
    PublicKey,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import {
    FastTransfer,
    TokenRouter,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network, Platform, toChainId } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainAddress,
    ChainsConfig,
    CircleBridge,
    Contracts,
    UnsignedTransaction,
} from "@wormhole-foundation/sdk-definitions";
import {
    AnySolanaAddress,
    SolanaAddress,
    SolanaChains,
    SolanaPlatform,
    SolanaTransaction,
    SolanaUnsignedTransaction,
} from "@wormhole-foundation/sdk-solana";
import { SolanaWormholeCore } from "@wormhole-foundation/sdk-solana-core";
import { ProgramId, TokenRouterProgram } from "../tokenRouter";

export interface SolanaTokenRouterContracts {
    tokenRouter: string;
    usdcMint: string;
}

export class SolanaTokenRouter<N extends Network, C extends SolanaChains>
    extends TokenRouterProgram
    implements TokenRouter<N, C>
{
    coreBridge: SolanaWormholeCore<N, C>;

    constructor(
        readonly _network: N,
        readonly _chain: C,
        readonly _connection: Connection,
        readonly _contracts: Contracts & SolanaTokenRouterContracts,
    ) {
        super(_connection, _contracts.tokenRouter as ProgramId, new PublicKey(_contracts.usdcMint));

        this.coreBridge = new SolanaWormholeCore(_network, _chain, _connection, {
            coreBridge: this.coreBridgeProgramId().toBase58(),
            ...this._contracts,
        });
    }

    static async fromRpc<N extends Network>(
        connection: Connection,
        config: ChainsConfig<N, Platform>,
        contracts: SolanaTokenRouterContracts,
    ) {
        const [network, chain] = await SolanaPlatform.chainFromRpc(connection);
        const conf = config[chain]!;
        if (conf.network !== network)
            throw new Error(`Network mismatch for chain ${chain}: ${conf.network} != ${network}`);

        return new SolanaTokenRouter(network as N, chain, connection, {
            ...config[chain]!.contracts,
            ...contracts,
        });
    }

    async *initialize(
        owner: AnySolanaAddress,
        ownerAssistant: AnySolanaAddress,
        mint?: AnySolanaAddress,
    ) {
        const sender = new SolanaAddress(owner).unwrap();
        const ix = await this.initializeIx({
            owner: sender,
            ownerAssistant: new SolanaAddress(ownerAssistant).unwrap(),
            mint: mint ? new SolanaAddress(mint).unwrap() : undefined,
        });

        const transaction = this.createTx(sender, [ix]);
        yield this.createUnsignedTx({ transaction }, "TokenRouter.Initialize");
    }

    async *prepareMarketOrder(
        sender: AnySolanaAddress,
        amount: bigint,
        redeemer: ChainAddress<Chain>,
        minAmountOut?: bigint,
        redeemerMessage?: Uint8Array,
        preparedOrder?: Keypair,
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        // assume sender token is the usdc mint address
        const senderToken = splToken.getAssociatedTokenAddressSync(this.mint, payer);

        // Where we'll write the prepared order
        preparedOrder = preparedOrder ?? Keypair.generate();

        const [approveIx, prepareIx] = await this.prepareMarketOrderIx(
            {
                payer,
                senderToken,
                preparedOrder: preparedOrder.publicKey,
            },
            {
                amountIn: amount,
                minAmountOut: minAmountOut !== undefined ? minAmountOut : null,
                targetChain: toChainId(redeemer.chain),
                redeemer: Array.from(redeemer.address.toUniversalAddress().toUint8Array()),
                redeemerMessage: redeemerMessage ? Buffer.from(redeemerMessage) : Buffer.from(""),
            },
        );

        // TODO: fix prepareMarketOrderIx to not return null at all
        const ixs = [];
        if (approveIx) ixs.push(approveIx);
        ixs.push(prepareIx);

        const transaction = this.createTx(payer, ixs);
        yield this.createUnsignedTx(
            { transaction, signers: [preparedOrder] },
            "TokenRouter.PrepareMarketOrder",
        );
    }

    async *closePreparedOrder(sender: AnySolanaAddress, order: AnySolanaAddress) {
        const payer = new SolanaAddress(sender).unwrap();
        const preparedOrder = new SolanaAddress(order).unwrap();

        const ix = await this.closePreparedOrderIx({
            preparedOrder,
            preparedBy: payer,
        });

        const transaction = this.createTx(payer, [ix]);
        yield this.createUnsignedTx({ transaction }, "TokenRouter.ClosePreparedOrder");
    }

    placeMarketOrder(
        amount: bigint,
        redeemer: ChainAddress<Chain>,
        redeemerMessage: Uint8Array,
        minAmountOut?: bigint | undefined,
        refundAddress?: AccountAddress<C> | undefined,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }

    placeFastMarketOrder<RC extends Chain>(
        amount: bigint,
        chain: RC,
        redeemer: AccountAddress<RC>,
        redeemerMessage: Uint8Array,
        maxFee: bigint,
        deadline: number,
        minAmountOut?: bigint | undefined,
        refundAddress?: string | undefined,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }

    redeemFill(
        vaa: FastTransfer.VAA,
        cctp: CircleBridge.Attestation,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
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
