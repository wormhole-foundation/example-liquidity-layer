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
    AuctionData,
    Custodian,
    PayerSequence,
    PreparedAuctionSettlement,
    RedeemedFastFill,
    RouterEndpoint,
} from "./state";
import { DepositForBurnWithCallerAccounts } from "../cctp/tokenMessengerMinter";
import { LiquidityLayerMessage } from "../messages";

export const PROGRAM_IDS = ["MatchingEngine11111111111111111111111111111"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

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
    tokenProgram: PublicKey;
};

export type RedeemFastFillAccounts = {
    custodian: PublicKey;
    redeemedFastFill: PublicKey;
    routerEndpoint: PublicKey;
    custodyToken: PublicKey;
    matchingEngineProgram: PublicKey;
    tokenProgram: PublicKey;
};

export type CctpMessageArgs = {
    encodedCctpMessage: Buffer;
    cctpAttestation: Buffer;
};

export class MatchingEngineProgram {
    private _programId: ProgramId;

    program: Program<MatchingEngine>;

    constructor(connection: Connection, programId?: ProgramId) {
        this._programId = programId ?? testnet();
        this.program = new Program(IDL as any, new PublicKey(this._programId), {
            connection,
        });
    }

    get ID(): PublicKey {
        return this.program.programId;
    }

    custodianAddress(): PublicKey {
        return Custodian.address(this.ID);
    }

    async fetchCustodian(addr: PublicKey): Promise<Custodian> {
        return this.program.account.custodian.fetch(addr);
    }

    custodyTokenAccountAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("custody")], this.ID)[0];
    }

    async fetchPayerSequence(addr: PublicKey): Promise<PayerSequence> {
        return this.program.account.payerSequence.fetch(addr);
    }

    routerEndpointAddress(chain: wormholeSdk.ChainId): PublicKey {
        return RouterEndpoint.address(this.ID, chain);
    }

    async fetchRouterEndpoint(addr: PublicKey): Promise<RouterEndpoint> {
        return this.program.account.routerEndpoint.fetch(addr);
    }

    auctionDataAddress(vaaHash: Array<number> | Buffer | Uint8Array): PublicKey {
        return AuctionData.address(this.ID, vaaHash);
    }

    async fetchAuctionData(vaaHash: Array<number> | Buffer | Uint8Array): Promise<AuctionData> {
        return this.program.account.auctionData.fetch(this.auctionDataAddress(vaaHash));
    }

    payerSequenceAddress(payer: PublicKey): PublicKey {
        return PayerSequence.address(this.ID, payer);
    }

    async fetchPayerSequenceValue(addr: PublicKey): Promise<BN> {
        return this.fetchPayerSequence(addr)
            .then((acct) => acct.value)
            .catch((_) => new BN(0));
    }

    coreMessageAddress(payer: PublicKey, payerSequenceValue: BN): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("msg"), payer.toBuffer(), payerSequenceValue.toBuffer("be", 8)],
            this.ID
        )[0];
    }

    redeemedFastFillAddress(vaaHash: Array<number> | Buffer | Uint8Array): PublicKey {
        return RedeemedFastFill.address(this.ID, vaaHash);
    }

    fetchRedeemedFastFill(addr: PublicKey): Promise<RedeemedFastFill> {
        return this.program.account.redeemedFastFill.fetch(addr);
    }

    preparedAuctionSettlementAddress(
        payer: PublicKey,
        fastVaaHash: Array<number> | Buffer | Uint8Array
    ): PublicKey {
        return PreparedAuctionSettlement.address(this.ID, payer, fastVaaHash);
    }

    fetchPreparedAuctionSettlement(addr: PublicKey): Promise<PreparedAuctionSettlement> {
        return this.program.account.preparedAuctionSettlement.fetch(addr);
    }

    async getBestOfferTokenAccount(vaaHash: Buffer | Uint8Array): Promise<PublicKey> {
        return (await this.fetchAuctionData(vaaHash)).bestOfferToken;
    }

    async getInitialOfferTokenAccount(vaaHash: Buffer): Promise<PublicKey> {
        return (await this.fetchAuctionData(vaaHash)).bestOfferToken;
    }

    async initializeIx(
        auctionConfig: AuctionConfig,
        accounts: {
            owner: PublicKey;
            ownerAssistant: PublicKey;
            feeRecipient: PublicKey;
            mint: PublicKey;
        }
    ): Promise<TransactionInstruction> {
        const { owner, ownerAssistant, feeRecipient, mint } = accounts;

        return this.program.methods
            .initialize(auctionConfig)
            .accounts({
                owner,
                custodian: this.custodianAddress(),
                ownerAssistant,
                feeRecipient,
                custodyToken: this.custodyTokenAccountAddress(),
                mint,
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
        return this.program.methods
            .addLocalRouterEndpoint()
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                routerEndpoint:
                    inputRouterEndpoint ?? this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
                tokenRouterProgram,
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
        custodian?: PublicKey;
        newFeeRecipient: PublicKey;
    }): Promise<TransactionInstruction> {
        const { ownerOrAssistant, custodian: inputCustodian, newFeeRecipient } = accounts;
        return this.program.methods
            .updateFeeRecipient()
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                newFeeRecipient,
            })
            .instruction();
    }

    async getCoreMessage(payer: PublicKey): Promise<PublicKey> {
        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue(payerSequence).then((value) =>
            this.coreMessageAddress(payer, value)
        );
        return coreMessage;
    }

    async placeInitialOfferIx(
        feeOffer: bigint,
        fromChain: wormholeSdk.ChainId,
        toChain: wormholeSdk.ChainId,
        vaaHash: Buffer,
        accounts: { payer: PublicKey; vaa: PublicKey; mint: PublicKey }
    ): Promise<TransactionInstruction> {
        const { payer, vaa, mint } = accounts;
        return this.program.methods
            .placeInitialOffer(new BN(feeOffer.toString()))
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                auctionData: this.auctionDataAddress(vaaHash),
                fromRouterEndpoint: this.routerEndpointAddress(fromChain),
                toRouterEndpoint: this.routerEndpointAddress(toChain),
                offerToken: splToken.getAssociatedTokenAddressSync(mint, payer),
                custodyToken: this.custodyTokenAccountAddress(),
                vaa,
            })
            .instruction();
    }

    async improveOfferIx(
        feeOffer: bigint,
        vaaHash: Buffer | Uint8Array,
        accounts: { offerAuthority: PublicKey; bestOfferToken?: PublicKey }
    ) {
        let { offerAuthority, bestOfferToken } = accounts;

        if (bestOfferToken === undefined) {
            bestOfferToken = await this.getBestOfferTokenAccount(vaaHash);
        }

        const { mint } = await splToken.getAccount(
            this.program.provider.connection,
            bestOfferToken
        );
        return this.program.methods
            .improveOffer(new BN(feeOffer.toString()))
            .accounts({
                offerAuthority,
                custodian: this.custodianAddress(),
                auctionData: this.auctionDataAddress(vaaHash),
                offerToken: splToken.getAssociatedTokenAddressSync(mint, offerAuthority),
                bestOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
            })
            .instruction();
    }

    async prepareAuctionSettlementCctpIx(
        accounts: {
            payer: PublicKey;
            fastVaa: PublicKey;
            finalizedVaa: PublicKey;
            mint: PublicKey;
        },
        args: CctpMessageArgs
    ): Promise<TransactionInstruction> {
        const { payer, fastVaa, finalizedVaa, mint } = accounts;
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
            tokenProgram,
        } = this.messageTransmitterProgram().receiveMessageAccounts(mint, encodedCctpMessage);

        return this.program.methods
            .prepareAuctionSettlementCctp(args)
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                fastVaa,
                finalizedVaa,
                preparedAuctionSettlement: this.preparedAuctionSettlementAddress(
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
                tokenProgram,
            })
            .instruction();
    }

    async settleAuctionCompleteIx(accounts: {
        preparedAuctionSettlement: PublicKey;
        auctionData?: PublicKey;
        preparedBy?: PublicKey;
        bestOfferToken?: PublicKey;
    }) {
        const {
            preparedAuctionSettlement,
            auctionData: inputAuctionData,
            preparedBy: inputPreparedBy,
            bestOfferToken: inputBestOfferToken,
        } = accounts;

        const { preparedBy, auctionData } = await (async () => {
            if (inputPreparedBy !== undefined && inputAuctionData !== undefined) {
                return {
                    preparedBy: inputPreparedBy,
                    auctionData: inputAuctionData,
                };
            } else {
                const { preparedBy, fastVaaHash } = await this.fetchPreparedAuctionSettlement(
                    preparedAuctionSettlement
                );
                return {
                    preparedBy,
                    auctionData: this.auctionDataAddress(fastVaaHash),
                };
            }
        })();

        const bestOfferToken = await (async () => {
            if (inputBestOfferToken !== undefined) {
                return inputBestOfferToken;
            } else {
                const { bestOfferToken } = await this.fetchAuctionData(
                    await this.fetchPreparedAuctionSettlement(preparedAuctionSettlement).then(
                        (acct) => acct.fastVaaHash
                    )
                );
                return bestOfferToken;
            }
        })();

        return this.program.methods
            .settleAuctionComplete()
            .accounts({
                custodian: this.custodianAddress(),
                preparedBy,
                preparedAuctionSettlement,
                auctionData,
                bestOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            })
            .instruction();
    }

    // async settleAuctionActiveCctpIx(
    //     accounts: {
    //         payer: PublicKey;
    //         fastVaa: PublicKey;
    //         liquidatorToken: PublicKey;
    //         preparedAuctionSettlement?: PublicKey;
    //         auctionData?: PublicKey;
    //         preparedBy?: PublicKey;
    //     },
    //     args: { targetChain: wormholeSdk.ChainId; remoteDomain?: number }
    // ) {
    //     const {
    //         payer,
    //         fastVaa,
    //         liquidatorToken,
    //         preparedAuctionSettlement: inputPreparedAuctionSettlement,
    //         auctionData: inputAuctionData,
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
    //         tokenProgram,
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
    //             preparedAuctionSettlement,
    //             auctionData,
    //             liquidatorToken,
    //         })
    //         .instruction();
    // }

    async settleAuctionNoneCctpIx() {
        return this.program.methods
            .settleAuctionNoneCctp()
            .accounts({
                custodian: this.custodianAddress(),
            })
            .instruction();
    }

    tokenMessengerMinterProgram(): TokenMessengerMinterProgram {
        switch (this._programId) {
            case testnet(): {
                return new TokenMessengerMinterProgram(
                    this.program.provider.connection,
                    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3"
                );
            }
            case mainnet(): {
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
            case mainnet(): {
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

    async executeFastOrderIx(
        targetChain: wormholeSdk.ChainId,
        remoteDomain: number,
        vaaHash: Buffer,
        accounts: {
            payer: PublicKey;
            vaa: PublicKey;
            bestOfferToken?: PublicKey;
            initialOfferToken?: PublicKey;
        }
    ) {
        let { payer, vaa, bestOfferToken, initialOfferToken } = accounts;

        if (bestOfferToken === undefined) {
            bestOfferToken = await this.getBestOfferTokenAccount(vaaHash);
        }

        if (initialOfferToken === undefined) {
            initialOfferToken = await this.getInitialOfferTokenAccount(vaaHash);
        }
        const { mint } = await splToken.getAccount(
            this.program.provider.connection,
            bestOfferToken
        );
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
            tokenProgram,
        } = await this.burnAndPublishAccounts(
            { payer, mint },
            { targetChain, destinationCctpDomain: remoteDomain }
        );

        return this.program.methods
            .executeFastOrder()
            .accounts({
                payer,
                custodian,
                auctionData: this.auctionDataAddress(vaaHash),
                toRouterEndpoint,
                executorToken: splToken.getAssociatedTokenAddressSync(mint, payer),
                bestOfferToken,
                initialOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
                vaa,
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
                tokenProgram,
            })
            .instruction();
    }

    async executeFastOrderSolanaIx(
        vaaHash: Buffer,
        accounts: {
            payer: PublicKey;
            vaa: PublicKey;
            bestOfferToken?: PublicKey;
            initialOfferToken?: PublicKey;
            toRouterEndpoint?: PublicKey;
        }
    ) {
        let { payer, vaa, bestOfferToken, initialOfferToken, toRouterEndpoint } = accounts;

        if (bestOfferToken === undefined) {
            bestOfferToken = await this.getBestOfferTokenAccount(vaaHash);
        }

        if (initialOfferToken === undefined) {
            initialOfferToken = await this.getInitialOfferTokenAccount(vaaHash);
        }

        if (toRouterEndpoint === undefined) {
            toRouterEndpoint = this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA);
        }

        const { mint } = await splToken.getAccount(
            this.program.provider.connection,
            bestOfferToken!
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

        return this.program.methods
            .executeFastOrderSolana()
            .accounts({
                payer,
                custodian,
                auctionData: this.auctionDataAddress(vaaHash),
                toRouterEndpoint,
                executorToken: splToken.getAssociatedTokenAddressSync(mint, payer),
                bestOfferToken,
                initialOfferToken,
                custodyToken: this.custodyTokenAccountAddress(),
                vaa,
                mint: USDC_MINT_ADDRESS,
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
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            },
        };
    }

    async publishMessageAccounts(payer: PublicKey): Promise<PublishMessageAccounts> {
        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue(payerSequence).then((value) =>
            this.coreMessageAddress(payer, value)
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
            mint: PublicKey;
        },
        args: {
            targetChain: wormholeSdk.ChainId;
            destinationCctpDomain: number;
        }
    ): Promise<BurnAndPublishAccounts> {
        const { payer, mint } = base;
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
            tokenProgram,
        } = this.tokenMessengerMinterProgram().depositForBurnWithCallerAccounts(
            mint,
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
            tokenProgram,
        };
    }

    coreBridgeProgramId(): PublicKey {
        switch (this._programId) {
            case testnet(): {
                return new PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");
            }
            case mainnet(): {
                return new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }
}

export function testnet(): ProgramId {
    return "MatchingEngine11111111111111111111111111111";
}

export function mainnet(): ProgramId {
    return "MatchingEngine11111111111111111111111111111";
}
