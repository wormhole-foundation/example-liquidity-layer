export * from "./state";

import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { IDL, MatchingEngine } from "../../../target/types/matching_engine";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";
import { MessageTransmitterProgram, TokenMessengerMinterProgram } from "../cctp";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, getProgramData } from "../utils";
import { VaaAccount } from "../wormhole";
import {
    AuctionConfig,
    Auction,
    Custodian,
    PayerSequence,
    PreparedOrderResponse,
    RedeemedFastFill,
    RouterEndpoint,
    AuctionParameters,
    AuctionInfo,
} from "./state";
import { LiquidityLayerMessage } from "../messages";

export const PROGRAM_IDS = [
    "MatchingEngine11111111111111111111111111111",
    "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS",
] as const;

export const FEE_PRECISION_MAX = 1_000_000n;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type VaaHash = Array<number> | Buffer | Uint8Array;

export type AddRouterEndpointArgs = {
    chain: wormholeSdk.ChainId;
    address: Array<number>;
    mintRecipient: Array<number> | null;
};

export type PublishMessageAccounts = {
    custodian: PublicKey;
    payerSequence: PublicKey;
    coreMessage: PublicKey;
    coreBridgeConfig: PublicKey;
    coreEmitterSequence: PublicKey;
    coreFeeCollector: PublicKey;
    coreBridgeProgram: PublicKey;
};

export type BurnAndPublishAccounts = {
    custodian: PublicKey;
    payerSequence: PublicKey;
    routerEndpoint: PublicKey;
    coreMessage: PublicKey;
    coreBridgeConfig: PublicKey;
    coreEmitterSequence: PublicKey;
    coreFeeCollector: PublicKey;
    coreBridgeProgram: PublicKey;
    tokenMessengerMinterSenderAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    tokenMessenger: PublicKey;
    remoteTokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    localToken: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
};

export type RedeemFastFillAccounts = {
    custodian: PublicKey;
    redeemedFastFill: PublicKey;
    routerEndpoint: PublicKey;
    custodyToken: PublicKey;
    matchingEngineProgram: PublicKey;
};

export type CctpMessageArgs = {
    encodedCctpMessage: Buffer;
    cctpAttestation: Buffer;
};

export class MatchingEngineProgram {
    private _programId: ProgramId;
    private _mint: PublicKey;

    program: Program<MatchingEngine>;

    constructor(connection: Connection, programId: ProgramId, mint: PublicKey) {
        this._programId = programId;
        this._mint = mint;
        this.program = new Program(IDL as any, new PublicKey(this._programId), {
            connection,
        });
    }

    get ID(): PublicKey {
        return this.program.programId;
    }

    get mint(): PublicKey {
        return this._mint;
    }

    custodianAddress(): PublicKey {
        return Custodian.address(this.ID);
    }

    async fetchCustodian(input?: { address: PublicKey }): Promise<Custodian> {
        const addr = input === undefined ? this.custodianAddress() : input.address;
        return this.program.account.custodian.fetch(addr);
    }

    auctionConfigAddress(id: number): PublicKey {
        return AuctionConfig.address(this.ID, id);
    }

    async fetchAuctionConfig(input: number | { address: PublicKey }): Promise<AuctionConfig> {
        const addr = typeof input === "number" ? this.auctionConfigAddress(input) : input.address;
        return this.program.account.auctionConfig.fetch(addr);
    }

    async fetchAuctionParameters(id?: number): Promise<AuctionParameters> {
        if (id === undefined) {
            const { auctionConfigId } = await this.fetchCustodian();
            id = auctionConfigId;
        }
        return this.fetchAuctionConfig(id).then((config) => config.parameters);
    }

    custodyTokenAccountAddress(): PublicKey {
        return splToken.getAssociatedTokenAddressSync(this.mint, this.custodianAddress(), true);
    }

    routerEndpointAddress(chain: number): PublicKey {
        return RouterEndpoint.address(this.ID, chain);
    }

    async fetchRouterEndpoint(input: number | { address: PublicKey }): Promise<RouterEndpoint> {
        const addr = typeof input === "number" ? this.routerEndpointAddress(input) : input.address;
        return this.program.account.routerEndpoint.fetch(addr);
    }

    auctionAddress(vaaHash: VaaHash): PublicKey {
        return Auction.address(this.ID, vaaHash);
    }

    async fetchAuction(input: VaaHash | { address: PublicKey }): Promise<Auction> {
        const addr = "address" in input ? input.address : this.auctionAddress(input);
        return this.program.account.auction.fetch(addr);
    }

    payerSequenceAddress(payer: PublicKey): PublicKey {
        return PayerSequence.address(this.ID, payer);
    }

    async fetchPayerSequence(input: PublicKey | { address: PublicKey }): Promise<PayerSequence> {
        const addr = "address" in input ? input.address : this.payerSequenceAddress(input);
        return this.program.account.payerSequence.fetch(addr);
    }

    async fetchPayerSequenceValue(input: PublicKey | { address: PublicKey }): Promise<bigint> {
        return this.fetchPayerSequence(input)
            .then((acct) => BigInt(acct.value.toString()))
            .catch((_) => 0n);
    }

    coreMessageAddress(payer: PublicKey, payerSequenceValue: bigint): PublicKey {
        const encodedPayerSequenceValue = Buffer.alloc(8);
        encodedPayerSequenceValue.writeBigUInt64BE(payerSequenceValue);
        return PublicKey.findProgramAddressSync(
            [Buffer.from("msg"), payer.toBuffer(), encodedPayerSequenceValue],
            this.ID
        )[0];
    }

    redeemedFastFillAddress(vaaHash: VaaHash): PublicKey {
        return RedeemedFastFill.address(this.ID, vaaHash);
    }

    fetchRedeemedFastFill(input: VaaHash | { address: PublicKey }): Promise<RedeemedFastFill> {
        const addr = "address" in input ? input.address : this.redeemedFastFillAddress(input);
        return this.program.account.redeemedFastFill.fetch(addr);
    }

    preparedOrderResponseAddress(preparedBy: PublicKey, fastVaaHash: VaaHash): PublicKey {
        return PreparedOrderResponse.address(this.ID, preparedBy, fastVaaHash);
    }

    fetchPreparedOrderResponse(
        input: [PublicKey, VaaHash] | { address: PublicKey }
    ): Promise<PreparedOrderResponse> {
        const addr =
            "address" in input ? input.address : this.preparedOrderResponseAddress(...input);
        return this.program.account.preparedOrderResponse.fetch(addr);
    }

    async initializeIx(
        auctionParams: AuctionParameters,
        accounts: {
            owner: PublicKey;
            ownerAssistant: PublicKey;
            feeRecipient: PublicKey;
            mint?: PublicKey;
        }
    ): Promise<TransactionInstruction> {
        const { owner, ownerAssistant, feeRecipient, mint: inputMint } = accounts;

        return this.program.methods
            .initialize(auctionParams)
            .accounts({
                owner,
                custodian: this.custodianAddress(),
                auctionConfig: this.auctionConfigAddress(0),
                ownerAssistant,
                feeRecipient,
                feeRecipientToken: splToken.getAssociatedTokenAddressSync(this.mint, feeRecipient),
                custodyToken: this.custodyTokenAccountAddress(),
                mint: inputMint ?? this.mint,
                programData: getProgramData(this.ID),
            })
            .instruction();
    }

    async submitOwnershipTransferIx(accounts: {
        owner: PublicKey;
        newOwner: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, newOwner, custodian: inputCustodian } = accounts;
        return this.program.methods
            .submitOwnershipTransferRequest()
            .accounts({
                owner,
                custodian: inputCustodian ?? this.custodianAddress(),
                newOwner,
                programData: getProgramData(this.ID),
                bpfLoaderUpgradeableProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            })
            .instruction();
    }

    async confirmOwnershipTransferIx(accounts: {
        pendingOwner: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { pendingOwner, custodian: inputCustodian } = accounts;
        return this.program.methods
            .confirmOwnershipTransferRequest()
            .accounts({
                pendingOwner,
                custodian: inputCustodian ?? this.custodianAddress(),
                programData: getProgramData(this.ID),
                bpfLoaderUpgradeableProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            })
            .instruction();
    }

    async cancelOwnershipTransferIx(accounts: {
        owner: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, custodian: inputCustodian } = accounts;
        return this.program.methods
            .cancelOwnershipTransferRequest()
            .accounts({
                owner,
                custodian: inputCustodian ?? this.custodianAddress(),
                programData: getProgramData(this.ID),
                bpfLoaderUpgradeableProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            })
            .instruction();
    }

    async updateOwnerAssistantIx(accounts: {
        owner: PublicKey;
        newOwnerAssistant: PublicKey;
        custodian?: PublicKey;
    }) {
        const { owner, newOwnerAssistant, custodian: inputCustodian } = accounts;
        return this.program.methods
            .updateOwnerAssistant()
            .accounts({
                owner,
                custodian: inputCustodian ?? this.custodianAddress(),
                newOwnerAssistant,
            })
            .instruction();
    }

    async addRouterEndpointIx(
        accounts: {
            ownerOrAssistant: PublicKey;
            custodian?: PublicKey;
            routerEndpoint?: PublicKey;
        },
        args: AddRouterEndpointArgs
    ): Promise<TransactionInstruction> {
        const {
            ownerOrAssistant,
            custodian: inputCustodian,
            routerEndpoint: inputRouterEndpoint,
        } = accounts;
        const { chain } = args;
        return this.program.methods
            .addRouterEndpoint(args)
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                routerEndpoint: inputRouterEndpoint ?? this.routerEndpointAddress(chain),
            })
            .instruction();
    }

    async addLocalRouterEndpointIx(accounts: {
        ownerOrAssistant: PublicKey;
        tokenRouterProgram: PublicKey;
        custodian?: PublicKey;
        routerEndpoint?: PublicKey;
    }): Promise<TransactionInstruction> {
        const {
            ownerOrAssistant,
            tokenRouterProgram,
            custodian: inputCustodian,
            routerEndpoint: inputRouterEndpoint,
        } = accounts;
        const [tokenRouterEmitter] = PublicKey.findProgramAddressSync(
            [Buffer.from("emitter")],
            tokenRouterProgram
        );
        return this.program.methods
            .addLocalRouterEndpoint()
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                routerEndpoint:
                    inputRouterEndpoint ?? this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
                tokenRouterProgram,
                tokenRouterEmitter,
                tokenRouterCustodyToken: splToken.getAssociatedTokenAddressSync(
                    this.mint,
                    tokenRouterEmitter,
                    true
                ),
            })
            .instruction();
    }

    async removeRouterEndpointIx(
        accounts: {
            ownerOrAssistant: PublicKey;
            custodian?: PublicKey;
            routerEndpoint?: PublicKey;
        },
        chain: wormholeSdk.ChainId
    ): Promise<TransactionInstruction> {
        const {
            ownerOrAssistant,
            custodian: inputCustodian,
            routerEndpoint: inputRouterEndpoint,
        } = accounts;
        return this.program.methods
            .removeRouterEndpoint()
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                routerEndpoint: inputRouterEndpoint ?? this.routerEndpointAddress(chain),
            })
            .instruction();
    }

    async updateFeeRecipientIx(accounts: {
        ownerOrAssistant: PublicKey;
        newFeeRecipient: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { ownerOrAssistant, newFeeRecipient, custodian: inputCustodian } = accounts;

        return this.program.methods
            .updateFeeRecipient()
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                newFeeRecipient,
                newFeeRecipientToken: splToken.getAssociatedTokenAddressSync(
                    this.mint,
                    newFeeRecipient
                ),
            })
            .instruction();
    }

    async getCoreMessage(payer: PublicKey, payerSequenceValue?: bigint): Promise<PublicKey> {
        const value = await (async () => {
            if (payerSequenceValue === undefined) {
                // Fetch the latest.
                const { value } = await this.fetchPayerSequence(payer);
                return BigInt(value.subn(1).toString());
            } else {
                return payerSequenceValue;
            }
        })();
        return this.coreMessageAddress(payer, value);
    }

    async fetchCustodyTokenAccount(): Promise<splToken.Account> {
        return splToken.getAccount(
            this.program.provider.connection,
            this.custodyTokenAccountAddress()
        );
    }

    async placeInitialOfferIx(
        accounts: {
            payer: PublicKey;
            fastVaa: PublicKey;
            offerToken?: PublicKey;
            auction?: PublicKey;
            auctionConfig?: PublicKey;
            fromRouterEndpoint?: PublicKey;
            toRouterEndpoint?: PublicKey;
        },
        feeOffer: bigint
    ): Promise<TransactionInstruction> {
        const {
            payer,
            fastVaa,
            offerToken: inputOfferToken,
            auction: inputAuction,
            auctionConfig: inputAuctionConfig,
            fromRouterEndpoint: inputFromRouterEndpoint,
            toRouterEndpoint: inputToRouterEndpoint,
        } = accounts;

        const custodyToken = this.custodyTokenAccountAddress();

        const offerToken = await (async () => {
            if (inputOfferToken !== undefined) {
                return inputOfferToken;
            } else {
                return splToken.getAssociatedTokenAddressSync(this.mint, payer);
            }
        })();

        const { auction, fromRouterEndpoint, toRouterEndpoint } = await (async () => {
            if (
                inputAuction === undefined ||
                inputFromRouterEndpoint === undefined ||
                inputToRouterEndpoint === undefined
            ) {
                const vaaAccount = await VaaAccount.fetch(
                    this.program.provider.connection,
                    fastVaa
                );
                const { fastMarketOrder } = LiquidityLayerMessage.decode(vaaAccount.payload());
                if (fastMarketOrder === undefined) {
                    throw new Error("Message not FastMarketOrder");
                }

                return {
                    auction: inputAuction ?? this.auctionAddress(vaaAccount.digest()),
                    fromRouterEndpoint:
                        inputFromRouterEndpoint ??
                        this.routerEndpointAddress(vaaAccount.emitterInfo().chain),
                    toRouterEndpoint:
                        inputToRouterEndpoint ??
                        this.routerEndpointAddress(fastMarketOrder.targetChain),
                };
            } else {
                return {
                    auction: inputAuction,
                    fromRouterEndpoint: inputFromRouterEndpoint,
                    toRouterEndpoint: inputToRouterEndpoint,
                };
            }
        })();

        const auctionConfig = await (async () => {
            if (inputAuctionConfig === undefined) {
                const { auctionConfigId } = await this.fetchCustodian();
                return this.auctionConfigAddress(auctionConfigId);
            } else {
                return inputAuctionConfig;
            }
        })();

        return this.program.methods
            .placeInitialOffer(new BN(feeOffer.toString()))
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                auctionConfig,
                auction,
                fromRouterEndpoint,
                toRouterEndpoint,
                offerToken,
                custodyToken,
                fastVaa,
            })
            .instruction();
    }

    async improveOfferIx(
        accounts: {
            auction: PublicKey;
            offerAuthority: PublicKey;
            auctionConfig?: PublicKey;
            bestOfferToken?: PublicKey;
        },
        feeOffer: bigint
    ) {
        const {
            offerAuthority,
            auction,
            auctionConfig: inputAuctionConfig,
            bestOfferToken: inputBestOfferToken,
        } = accounts;

        const { auctionConfig, bestOfferToken } = await (async () => {
            if (inputAuctionConfig === undefined || inputBestOfferToken === undefined) {
                const { info } = await this.fetchAuction({ address: auction });
                if (info === null) {
                    throw new Error("no auction info found");
                }

                return {
                    auctionConfig: inputAuctionConfig ?? this.auctionConfigAddress(info.configId),
                    bestOfferToken: inputBestOfferToken ?? info.bestOfferToken,
                };
            } else {
                return {
                    auctionConfig: inputAuctionConfig,
                    bestOfferToken: inputBestOfferToken,
                };
            }
        })();

        return this.program.methods
            .improveOffer(new BN(feeOffer.toString()))
            .accounts({
                offerAuthority,
                custodian: this.custodianAddress(),
                auctionConfig,
                auction,
                offerToken: splToken.getAssociatedTokenAddressSync(this.mint, offerAuthority),
                bestOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
            })
            .instruction();
    }

    async prepareOrderResponseCctpIx(
        accounts: {
            payer: PublicKey;
            fastVaa: PublicKey;
            finalizedVaa: PublicKey;
            mint?: PublicKey;
        },
        args: CctpMessageArgs
    ): Promise<TransactionInstruction> {
        const { payer, fastVaa, finalizedVaa, mint: inputMint } = accounts;

        const fastVaaAcct = await VaaAccount.fetch(this.program.provider.connection, fastVaa);
        const { encodedCctpMessage } = args;
        const {
            authority: messageTransmitterAuthority,
            messageTransmitterConfig,
            usedNonces,
            tokenMessengerMinterProgram,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            tokenPair,
            custodyToken: tokenMessengerMinterCustodyToken,
            messageTransmitterProgram,
        } = this.messageTransmitterProgram().receiveMessageAccounts(
            inputMint ?? this.mint,
            encodedCctpMessage
        );

        return this.program.methods
            .prepareOrderResponseCctp(args)
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                fastVaa,
                finalizedVaa,
                preparedOrderResponse: this.preparedOrderResponseAddress(
                    payer,
                    fastVaaAcct.digest()
                ),
                custodyToken: this.custodyTokenAccountAddress(),
                messageTransmitterAuthority,
                messageTransmitterConfig,
                usedNonces,
                tokenMessenger,
                remoteTokenMessenger,
                tokenMinter,
                localToken,
                tokenPair,
                tokenMessengerMinterCustodyToken,
                tokenMessengerMinterProgram,
                messageTransmitterProgram,
            })
            .instruction();
    }

    async settleAuctionCompleteIx(accounts: {
        preparedOrderResponse: PublicKey;
        auction?: PublicKey;
        preparedBy?: PublicKey;
        bestOfferToken?: PublicKey;
    }) {
        const {
            preparedOrderResponse,
            auction: inputAuction,
            preparedBy: inputPreparedBy,
            bestOfferToken: inputBestOfferToken,
        } = accounts;

        const { preparedBy, auction } = await (async () => {
            if (inputPreparedBy !== undefined && inputAuction !== undefined) {
                return {
                    preparedBy: inputPreparedBy,
                    auction: inputAuction,
                };
            } else {
                const { preparedBy, fastVaaHash } = await this.fetchPreparedOrderResponse({
                    address: preparedOrderResponse,
                });
                return {
                    preparedBy: inputPreparedBy ?? preparedBy,
                    auction: inputAuction ?? this.auctionAddress(fastVaaHash),
                };
            }
        })();

        const bestOfferToken = await (async () => {
            if (inputBestOfferToken !== undefined) {
                return inputBestOfferToken;
            } else {
                const { info } = await this.fetchAuction({ address: auction });
                if (info === null) {
                    throw new Error("no auction info found");
                }
                return info.bestOfferToken;
            }
        })();

        return this.program.methods
            .settleAuctionComplete()
            .accounts({
                custodian: this.custodianAddress(),
                preparedBy,
                preparedOrderResponse,
                auction,
                bestOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
            })
            .instruction();
    }

    // async settleAuctionActiveCctpIx(
    //     accounts: {
    //         payer: PublicKey;
    //         fastVaa: PublicKey;
    //         liquidatorToken: PublicKey;
    //         preparedOrderResponse?: PublicKey;
    //         auction?: PublicKey;
    //         preparedBy?: PublicKey;
    //     },
    //     args: { targetChain: wormholeSdk.ChainId; remoteDomain?: number }
    // ) {
    //     const {
    //         payer,
    //         fastVaa,
    //         liquidatorToken,
    //         preparedOrderResponse: inputPreparedAuctionSettlement,
    //         auction: inputAuction,
    //         preparedBy: inputPreparedBy,
    //     } = accounts;

    //     const { mint } = await splToken.getAccount(
    //         this.program.provider.connection,
    //         liquidatorToken
    //     );

    //     const { targetChain, remoteDomain: inputRemoteDomain } = args;
    //     const destinationCctpDomain = await (async () => {
    //         if (inputRemoteDomain !== undefined) {
    //             return inputRemoteDomain;
    //         } else {
    //             const message = await VaaAccount.fetch(
    //                 this.program.provider.connection,
    //                 fastVaa
    //             ).then((vaa) => LiquidityLayerMessage.decode(vaa.payload()));
    //             if (message.fastMarketOrder === undefined) {
    //                 throw new Error("Message not FastMarketOrder");
    //             }
    //             return message.fastMarketOrder.destinationCctpDomain;
    //         }
    //     })();

    //     const {
    //         custodian,
    //         payerSequence,
    //         routerEndpoint: toRouterEndpoint,
    //         coreMessage,
    //         coreBridgeConfig,
    //         coreEmitterSequence,
    //         coreFeeCollector,
    //         coreBridgeProgram,
    //         tokenMessengerMinterSenderAuthority,
    //         messageTransmitterConfig,
    //         tokenMessenger,
    //         remoteTokenMessenger,
    //         tokenMinter,
    //         localToken,
    //         messageTransmitterProgram,
    //         tokenMessengerMinterProgram,
    //     } = await this.burnAndPublishAccounts(
    //         { payer, mint },
    //         { targetChain, destinationCctpDomain }
    //     );

    //     return this.program.methods
    //         .settleAuctionActiveCctp()
    //         .accounts({
    //             payer,
    //             payerSequence,
    //             custodian,
    //             fastVaa,
    //             preparedBy,
    //             preparedOrderResponse,
    //             auction,
    //             liquidatorToken,
    //         })
    //         .instruction();
    // }

    async settleAuctionNoneLocalIx() {
        return this.program.methods
            .settleAuctionNoneCctp()
            .accounts({
                custodian: this.custodianAddress(),
            })
            .instruction();
    }

    async settleAuctionNoneCctpIx(accounts: {
        payer: PublicKey;
        fastVaa: PublicKey;
        preparedOrderResponse: PublicKey;
    }) {
        const { payer, fastVaa, preparedOrderResponse } = accounts;

        const fastVaaAccount = await VaaAccount.fetch(this.program.provider.connection, fastVaa);
        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        if (fastMarketOrder === undefined) {
            throw new Error("Message not FastMarketOrder");
        }

        const { targetChain, destinationCctpDomain } = fastMarketOrder;

        const { preparedBy } = await this.fetchPreparedOrderResponse({
            address: preparedOrderResponse,
        });

        const {
            custodian,
            payerSequence,
            routerEndpoint: toRouterEndpoint,
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
            tokenMessengerMinterSenderAuthority,
            messageTransmitterConfig,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        } = await this.burnAndPublishAccounts({ payer }, { targetChain, destinationCctpDomain });

        const { feeRecipientToken } = await this.fetchCustodian();

        return this.program.methods
            .settleAuctionNoneCctp()
            .accounts({
                payer,
                payerSequence,
                custodian,
                fastVaa,
                preparedBy,
                preparedOrderResponse,
                auction: this.auctionAddress(fastVaaAccount.digest()),
                custodyToken: this.custodyTokenAccountAddress(),
                feeRecipientToken,
                mint: this.mint,
                fromRouterEndpoint: this.routerEndpointAddress(fastVaaAccount.emitterInfo().chain),
                toRouterEndpoint,
                coreBridgeConfig,
                coreMessage,
                coreEmitterSequence,
                coreFeeCollector,
                tokenMessengerMinterSenderAuthority,
                messageTransmitterConfig,
                tokenMessenger,
                remoteTokenMessenger,
                tokenMinter,
                localToken,
                coreBridgeProgram,
                tokenMessengerMinterProgram,
                messageTransmitterProgram,
            })
            .instruction();
    }

    async executeFastOrderCctpIx(accounts: {
        payer: PublicKey;
        fastVaa: PublicKey;
        executorToken?: PublicKey;
        auction?: PublicKey;
        auctionConfig?: PublicKey;
        bestOfferToken?: PublicKey;
        initialOfferToken?: PublicKey;
    }) {
        const {
            payer,
            fastVaa,
            executorToken: inputExecutorToken,
            auction: inputAuction,
            auctionConfig: inputAuctionConfig,
            bestOfferToken: inputBestOfferToken,
            initialOfferToken: inputInitialOfferToken,
        } = accounts;

        // TODO: Think of a way to not have to do this fetch.
        const vaaAccount = await VaaAccount.fetch(this.program.provider.connection, fastVaa);
        const { fastMarketOrder } = LiquidityLayerMessage.decode(vaaAccount.payload());
        if (fastMarketOrder === undefined) {
            throw new Error("Message not FastMarketOrder");
        }

        const auction = inputAuction ?? this.auctionAddress(vaaAccount.digest());

        const { auctionConfig, initialOfferToken, bestOfferToken } = await (async () => {
            if (
                inputAuctionConfig === undefined ||
                inputInitialOfferToken === undefined ||
                inputBestOfferToken === undefined
            ) {
                const { info } = await this.fetchAuction({ address: auction });
                if (info === null) {
                    throw new Error("no auction info found");
                }
                const { configId, initialOfferToken, bestOfferToken } = info;
                return {
                    auctionConfig: inputAuctionConfig ?? this.auctionConfigAddress(configId),
                    initialOfferToken: inputInitialOfferToken ?? initialOfferToken,
                    bestOfferToken: inputBestOfferToken ?? bestOfferToken,
                };
            } else {
                return {
                    auctionConfig: inputAuctionConfig,
                    initialOfferToken: inputInitialOfferToken,
                    bestOfferToken: inputBestOfferToken,
                };
            }
        })();

        const {
            custodian,
            payerSequence,
            routerEndpoint: toRouterEndpoint,
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
            tokenMessengerMinterSenderAuthority,
            messageTransmitterConfig,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        } = await this.burnAndPublishAccounts({ payer }, fastMarketOrder);

        const mint = this.mint;
        return this.program.methods
            .executeFastOrderCctp()
            .accounts({
                payer,
                custodian,
                auctionConfig,
                fastVaa,
                auction,
                toRouterEndpoint,
                executorToken:
                    inputExecutorToken ?? splToken.getAssociatedTokenAddressSync(mint, payer),
                bestOfferToken,
                initialOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
                mint,
                payerSequence,
                coreBridgeConfig,
                coreMessage,
                coreEmitterSequence,
                coreFeeCollector,
                tokenMessengerMinterSenderAuthority,
                messageTransmitterConfig,
                tokenMessenger,
                remoteTokenMessenger,
                tokenMinter,
                localToken,
                coreBridgeProgram,
                tokenMessengerMinterProgram,
                messageTransmitterProgram,
            })
            .instruction();
    }

    async executeFastOrderLocalIx(accounts: {
        payer: PublicKey;
        fastVaa: PublicKey;
        executorToken?: PublicKey;
        auction?: PublicKey;
        auctionConfig?: PublicKey;
        bestOfferToken?: PublicKey;
        initialOfferToken?: PublicKey;
        toRouterEndpoint?: PublicKey;
    }) {
        const {
            payer,
            fastVaa,
            executorToken: inputExecutorToken,
            auction: inputAuction,
            auctionConfig: inputAuctionConfig,
            bestOfferToken: inputBestOfferToken,
            initialOfferToken: inputInitialOfferToken,
            toRouterEndpoint: inputToRouterEndpoint,
        } = accounts;

        const vaaAccount = await VaaAccount.fetch(this.program.provider.connection, fastVaa);
        const auction = inputAuction ?? this.auctionAddress(vaaAccount.digest());

        const { auctionConfig, initialOfferToken, bestOfferToken } = await (async () => {
            if (
                inputAuctionConfig === undefined ||
                inputInitialOfferToken === undefined ||
                inputBestOfferToken === undefined
            ) {
                const { info } = await this.fetchAuction({ address: auction });
                if (info === null) {
                    throw new Error("no auction info found");
                }
                const { configId, initialOfferToken, bestOfferToken } = info;
                return {
                    auctionConfig: inputAuctionConfig ?? this.auctionConfigAddress(configId),
                    initialOfferToken: inputInitialOfferToken ?? initialOfferToken,
                    bestOfferToken: inputBestOfferToken ?? bestOfferToken,
                };
            } else {
                return {
                    auctionConfig: inputAuctionConfig,
                    initialOfferToken: inputInitialOfferToken,
                    bestOfferToken: inputBestOfferToken,
                };
            }
        })();

        const {
            custodian,
            payerSequence,
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
        } = await this.publishMessageAccounts(payer);

        return this.program.methods
            .executeFastOrderLocal()
            .accounts({
                payer,
                custodian,
                auctionConfig,
                fastVaa,
                auction,
                toRouterEndpoint:
                    inputToRouterEndpoint ??
                    this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
                executorToken:
                    inputExecutorToken ?? splToken.getAssociatedTokenAddressSync(this.mint, payer),
                bestOfferToken,
                initialOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
                payerSequence,
                coreBridgeConfig,
                coreMessage,
                coreEmitterSequence,
                coreFeeCollector,
                coreBridgeProgram,
            })
            .instruction();
    }

    async redeemFastFillAccounts(
        vaa: PublicKey
    ): Promise<{ vaaAccount: VaaAccount; accounts: RedeemFastFillAccounts }> {
        const vaaAccount = await VaaAccount.fetch(this.program.provider.connection, vaa);

        return {
            vaaAccount,
            accounts: {
                custodian: this.custodianAddress(),
                redeemedFastFill: this.redeemedFastFillAddress(vaaAccount.digest()),
                routerEndpoint: this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
                custodyToken: this.custodyTokenAccountAddress(),
                matchingEngineProgram: this.ID,
            },
        };
    }

    async publishMessageAccounts(payer: PublicKey): Promise<PublishMessageAccounts> {
        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue({ address: payerSequence }).then(
            (value) => this.coreMessageAddress(payer, value)
        );

        const coreBridgeProgram = this.coreBridgeProgramId();
        const custodian = this.custodianAddress();

        return {
            custodian,
            payerSequence,
            coreMessage,
            coreBridgeConfig: PublicKey.findProgramAddressSync(
                [Buffer.from("Bridge")],
                coreBridgeProgram
            )[0],
            coreEmitterSequence: PublicKey.findProgramAddressSync(
                [Buffer.from("Sequence"), custodian.toBuffer()],
                coreBridgeProgram
            )[0],
            coreFeeCollector: PublicKey.findProgramAddressSync(
                [Buffer.from("fee_collector")],
                coreBridgeProgram
            )[0],
            coreBridgeProgram,
        };
    }

    async burnAndPublishAccounts(
        base: {
            payer: PublicKey;
            mint?: PublicKey;
        },
        args: {
            targetChain: number;
            destinationCctpDomain: number;
        }
    ): Promise<BurnAndPublishAccounts> {
        const { payer, mint: inputMint } = base;
        const { targetChain, destinationCctpDomain } = args;

        const {
            senderAuthority: tokenMessengerMinterSenderAuthority,
            messageTransmitterConfig,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        } = this.tokenMessengerMinterProgram().depositForBurnWithCallerAccounts(
            inputMint ?? this.mint,
            destinationCctpDomain
        );

        const {
            custodian,
            payerSequence,
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
        } = await this.publishMessageAccounts(payer);

        return {
            custodian,
            payerSequence,
            routerEndpoint: this.routerEndpointAddress(targetChain),
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
            tokenMessengerMinterSenderAuthority,
            messageTransmitterConfig,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        };
    }

    tokenMessengerMinterProgram(): TokenMessengerMinterProgram {
        switch (this._programId) {
            case testnet(): {
                return new TokenMessengerMinterProgram(
                    this.program.provider.connection,
                    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
                );
            }
            case localnet(): {
                return new TokenMessengerMinterProgram(
                    this.program.provider.connection,
                    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
                );
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }

    messageTransmitterProgram(): MessageTransmitterProgram {
        switch (this._programId) {
            case testnet(): {
                return new MessageTransmitterProgram(
                    this.program.provider.connection,
                    "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
                );
            }
            case localnet(): {
                return new MessageTransmitterProgram(
                    this.program.provider.connection,
                    "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
                );
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }

    coreBridgeProgramId(): PublicKey {
        switch (this._programId) {
            case testnet(): {
                return new PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");
            }
            case localnet(): {
                return new PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }

    async computeDepositPenalty(
        auctionInfo: AuctionInfo,
        currentSlot: bigint,
        configId?: number
    ): Promise<{ penalty: bigint; userReward: bigint }> {
        const auctionParams = await this.fetchAuctionParameters(configId);

        const gracePeriod = BigInt(auctionParams.gracePeriod);
        const slotsElapsed =
            currentSlot - BigInt(auctionInfo.startSlot.toString()) - BigInt(auctionParams.duration);
        if (slotsElapsed <= gracePeriod) {
            return { penalty: 0n, userReward: 0n };
        }

        const amount = BigInt(auctionInfo.securityDeposit.toString());

        const penaltyPeriod = slotsElapsed - gracePeriod;
        const auctionPenaltySlots = BigInt(auctionParams.penaltySlots);
        const initialPenaltyBps = BigInt(auctionParams.initialPenaltyBps);
        const userPenaltyRewardBps = BigInt(auctionParams.userPenaltyRewardBps);

        if (penaltyPeriod >= auctionPenaltySlots || initialPenaltyBps == FEE_PRECISION_MAX) {
            const userReward = (amount * userPenaltyRewardBps) / FEE_PRECISION_MAX;
            return { penalty: amount - userReward, userReward };
        } else {
            const basePenalty = (amount * initialPenaltyBps) / FEE_PRECISION_MAX;
            const penalty =
                basePenalty + ((amount - basePenalty) * penaltyPeriod) / auctionPenaltySlots;
            const userReward = (penalty * userPenaltyRewardBps) / FEE_PRECISION_MAX;

            return { penalty: penalty - userReward, userReward };
        }
    }
}

export function testnet(): ProgramId {
    return "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
}

export function localnet(): ProgramId {
    return "MatchingEngine11111111111111111111111111111";
}
