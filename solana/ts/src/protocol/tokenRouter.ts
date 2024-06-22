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
    FastMarketOrder,
    FastTransfer,
    Message,
    TokenRouter,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, ChainId, Network, Platform, toChainId } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    ChainAddress,
    ChainsConfig,
    CircleBridge,
    Contracts,
    UniversalAddress,
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

    private usdcMint(wallet: PublicKey) {
        return splToken.getAssociatedTokenAddressSync(this.mint, wallet);
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

    private makeFastMarketOrder(
        sender: AnySolanaAddress,
        order: Partial<FastMarketOrder>,
    ): FastMarketOrder {
        const senderAddress = new SolanaAddress(sender).toUniversalAddress();
        const o: FastMarketOrder = {
            // TODO: from auction params? take as args?
            maxFee: order.maxFee ?? 0n,
            initAuctionFee: order.initAuctionFee ?? 0n,
            deadline: order.deadline ?? 0,
            // TODO: specify which params we need, not just partial
            amountIn: order.amountIn!,
            minAmountOut: order.minAmountOut!,
            targetChain: order.targetChain!,
            redeemer: order.redeemer!,
            // TODO: which of these can we assume? any
            sender: order.sender ?? senderAddress,
            refundAddress: order.refundAddress ?? senderAddress,
            redeemerMessage: order.redeemerMessage ?? new Uint8Array(),
        };

        return o;
    }

    private async _prepareMarketOrderIxs(
        sender: AnySolanaAddress,
        order: TokenRouter.OrderRequest,
        prepareTo?: Keypair,
    ): Promise<[TransactionInstruction[], Keypair[]]> {
        const payer = new SolanaAddress(sender).unwrap();

        // TODO: assumes sender token is the usdc mint address
        const senderToken = this.usdcMint(payer);

        // Where we'll write the prepared order
        prepareTo = prepareTo ?? Keypair.generate();

        const [approveIx, prepareIx] = await this.prepareMarketOrderIx(
            {
                payer,
                senderToken,
                preparedOrder: prepareTo.publicKey,
            },
            {
                amountIn: order.amountIn,
                minAmountOut: order.minAmountOut !== undefined ? order.minAmountOut : null,
                targetChain: toChainId(order.targetChain),
                redeemer: Array.from(order.redeemer.toUint8Array()),
                redeemerMessage: order.redeemerMessage
                    ? Buffer.from(order.redeemerMessage)
                    : Buffer.from(""),
            },
        );

        // TODO: fix prepareMarketOrderIx to not return null at all?
        const ixs = [];
        if (approveIx) ixs.push(approveIx);
        ixs.push(prepareIx);

        return [ixs, [prepareTo]];
    }

    async *prepareMarketOrder(
        sender: AnySolanaAddress,
        order: TokenRouter.OrderRequest,
        prepareTo?: Keypair,
    ) {
        const payer = new SolanaAddress(sender).unwrap();

        const [ixs, signers] = await this._prepareMarketOrderIxs(sender, order, prepareTo);

        const transaction = this.createTx(payer, ixs);
        yield this.createUnsignedTx({ transaction, signers }, "TokenRouter.PrepareMarketOrder");
    }

    async *closePreparedOrder(sender: AnySolanaAddress, order: AnySolanaAddress) {
        const payer = new SolanaAddress(sender).unwrap();
        const preparedOrder = new SolanaAddress(order).unwrap();

        const ix = await this.closePreparedOrderIx({
            preparedOrder,
            preparedBy: payer,
            orderSender: payer,
        });

        const transaction = this.createTx(payer, [ix]);

        yield this.createUnsignedTx({ transaction }, "TokenRouter.ClosePreparedOrder");
    }

    async *placeMarketOrder(
        sender: AnySolanaAddress,
        order: TokenRouter.OrderRequest | AnySolanaAddress,
        prepareTo?: Keypair,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        const payer = new SolanaAddress(sender).unwrap();

        let ixs: TransactionInstruction[] = [];
        let signers: Keypair[] = [];
        let preparedOrder: PublicKey;
        let targetChain: ChainId | undefined;

        if (TokenRouter.isOrderRequest(order)) {
            prepareTo = prepareTo ?? Keypair.generate();

            const combined = false; // TODO how to choose?
            if (combined) {
                const [ixs, signers] = await this._prepareMarketOrderIxs(sender, order, prepareTo);
                ixs.push(...ixs);
                signers.push(...signers);
            } else {
                yield* this.prepareMarketOrder(sender, order, prepareTo);
            }

            preparedOrder = prepareTo.publicKey;
            targetChain = toChainId(order.targetChain);
        } else {
            preparedOrder = new SolanaAddress(order).unwrap();
        }

        const ix = await this.placeMarketOrderCctpIx(
            {
                payer,
                preparedOrder,
                preparedBy: payer,
            },
            // TODO: add cctpDomain fn
            { targetChain }, //,destinationDomain: 3 },
        );
        ixs.push(ix);

        const transaction = this.createTx(payer, ixs);
        yield this.createUnsignedTx({ transaction, signers }, "TokenRouter.PlaceMarketOrder");
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
