export * from "./state";

import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    Connection,
    PublicKey,
    SYSVAR_CLOCK_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    SYSVAR_EPOCH_SCHEDULE_PUBKEY,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
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
    Proposal,
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

export type AddCctpRouterEndpointArgs = {
    chain: number;
    cctpDomain: number;
    address: Array<number>;
    mintRecipient: Array<number> | null;
};

export type WormholeCoreBridgeAccounts = {
    coreBridgeConfig: PublicKey;
    coreEmitterSequence: PublicKey;
    coreFeeCollector: PublicKey;
    coreBridgeProgram: PublicKey;
};

export type PublishMessageAccounts = WormholeCoreBridgeAccounts & {
    custodian: PublicKey;
    coreMessage: PublicKey;
};

export type MatchingEngineCommonAccounts = WormholeCoreBridgeAccounts & {
    matchingEngineProgram: PublicKey;
    systemProgram: PublicKey;
    rent: PublicKey;
    clock: PublicKey;
    custodian: PublicKey;
    cctpMintRecipient: PublicKey;
    tokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    tokenMessengerMinterSenderAuthority: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
    messageTransmitterAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenProgram: PublicKey;
    mint: PublicKey;
    localToken: PublicKey;
    tokenMessengerMinterCustodyToken: PublicKey;
};

export type BurnAndPublishAccounts = {
    custodian: PublicKey;
    payerSequence: PublicKey;
    routerEndpoint: PublicKey;
    coreMessage: PublicKey;
    cctpMessage: PublicKey;
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
    tokenMessengerMinterEventAuthority: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
};

export type RedeemFastFillAccounts = {
    custodian: PublicKey;
    redeemedFastFill: PublicKey;
    routerEndpoint: PublicKey;
    cctpMintRecipient: PublicKey;
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

    cctpMintRecipientAddress(): PublicKey {
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

    async proposalAddress(proposalId?: BN): Promise<PublicKey> {
        if (proposalId === undefined) {
            const { nextProposalId } = await this.fetchCustodian();
            proposalId = nextProposalId;
        }

        return Proposal.address(this.ID, proposalId);
    }

    async fetchProposal(input?: { address: PublicKey }): Promise<Proposal> {
        const addr = input === undefined ? await this.proposalAddress() : input.address;
        return this.program.account.proposal.fetch(addr);
    }

    coreMessageAddress(payer: PublicKey, payerSequenceValue: BN | bigint): PublicKey {
        const encodedPayerSequenceValue = Buffer.alloc(8);
        encodedPayerSequenceValue.writeBigUInt64BE(BigInt(payerSequenceValue.toString()));
        return PublicKey.findProgramAddressSync(
            [Buffer.from("core-msg"), payer.toBuffer(), encodedPayerSequenceValue],
            this.ID,
        )[0];
    }

    cctpMessageAddress(payer: PublicKey, payerSequenceValue: BN | bigint): PublicKey {
        const encodedPayerSequenceValue = Buffer.alloc(8);
        encodedPayerSequenceValue.writeBigUInt64BE(BigInt(payerSequenceValue.toString()));
        return PublicKey.findProgramAddressSync(
            [Buffer.from("cctp-msg"), payer.toBuffer(), encodedPayerSequenceValue],
            this.ID,
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
        input: [PublicKey, VaaHash] | { address: PublicKey },
    ): Promise<PreparedOrderResponse> {
        const addr =
            "address" in input ? input.address : this.preparedOrderResponseAddress(...input);
        return this.program.account.preparedOrderResponse.fetch(addr);
    }

    async approveCustodianIx(
        owner: PublicKey,
        amount: bigint | number,
    ): Promise<TransactionInstruction> {
        return splToken.createApproveInstruction(
            splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, owner),
            this.custodianAddress(),
            owner,
            amount,
        );
    }

    async commonAccounts(): Promise<MatchingEngineCommonAccounts> {
        const custodian = this.custodianAddress();
        const { coreBridgeConfig, coreEmitterSequence, coreFeeCollector, coreBridgeProgram } =
            await this.publishMessageAccounts(PublicKey.default, 0n);

        const tokenMessengerMinterProgram = this.tokenMessengerMinterProgram();
        const messageTransmitterProgram = this.messageTransmitterProgram();

        const cctpMintRecipient = this.cctpMintRecipientAddress();
        const mint = this.mint;

        return {
            matchingEngineProgram: this.ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            clock: SYSVAR_CLOCK_PUBKEY,
            custodian,
            cctpMintRecipient,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
            tokenMessenger: tokenMessengerMinterProgram.tokenMessengerAddress(),
            tokenMinter: tokenMessengerMinterProgram.tokenMinterAddress(),
            tokenMessengerMinterSenderAuthority:
                tokenMessengerMinterProgram.senderAuthorityAddress(),
            tokenMessengerMinterProgram: tokenMessengerMinterProgram.ID,
            messageTransmitterAuthority: messageTransmitterProgram.authorityAddress(
                tokenMessengerMinterProgram.ID,
            ),
            messageTransmitterConfig: messageTransmitterProgram.messageTransmitterConfigAddress(),
            messageTransmitterProgram: messageTransmitterProgram.ID,
            tokenProgram: splToken.TOKEN_PROGRAM_ID,
            mint,
            localToken: tokenMessengerMinterProgram.localTokenAddress(mint),
            tokenMessengerMinterCustodyToken: tokenMessengerMinterProgram.custodyTokenAddress(mint),
        };
    }

    async initializeIx(
        accounts: {
            owner: PublicKey;
            ownerAssistant: PublicKey;
            feeRecipient: PublicKey;
            mint?: PublicKey;
        },
        auctionParams: AuctionParameters,
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
                cctpMintRecipient: this.cctpMintRecipientAddress(),
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

    async addCctpRouterEndpointIx(
        accounts: {
            ownerOrAssistant: PublicKey;
            custodian?: PublicKey;
            routerEndpoint?: PublicKey;
            remoteTokenMessenger?: PublicKey;
        },
        args: AddCctpRouterEndpointArgs,
    ): Promise<TransactionInstruction> {
        const {
            ownerOrAssistant,
            custodian: inputCustodian,
            routerEndpoint: inputRouterEndpoint,
            remoteTokenMessenger: inputRemoteTokenMessenger,
        } = accounts;
        const { chain, cctpDomain } = args;
        const derivedRemoteTokenMessenger =
            this.tokenMessengerMinterProgram().remoteTokenMessengerAddress(cctpDomain);

        return this.program.methods
            .addCctpRouterEndpoint(args)
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                routerEndpoint: inputRouterEndpoint ?? this.routerEndpointAddress(chain),
                remoteTokenMessenger: inputRemoteTokenMessenger ?? derivedRemoteTokenMessenger,
            })
            .instruction();
    }

    async proposeAuctionParametersIx(
        accounts: {
            ownerOrAssistant: PublicKey;
            custodian?: PublicKey;
            proposal?: PublicKey;
        },
        parameters: AuctionParameters,
    ): Promise<TransactionInstruction> {
        const { ownerOrAssistant, custodian: inputCustodian, proposal: inputProposal } = accounts;

        return this.program.methods
            .proposeAuctionParameters(parameters)
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                proposal: inputProposal ?? (await this.proposalAddress()),
                epochSchedule: SYSVAR_EPOCH_SCHEDULE_PUBKEY,
            })
            .instruction();
    }

    async updateAuctionParametersIx(accounts: {
        owner: PublicKey;
        custodian?: PublicKey;
        proposal?: PublicKey;
        auctionConfig?: PublicKey;
    }): Promise<TransactionInstruction> {
        const {
            owner,
            custodian: inputCustodian,
            proposal: inputProposal,
            auctionConfig: inputAuctionConfig,
        } = accounts;

        // Add 1 to the current auction config ID to get the next one.
        const auctionConfig = await (async () => {
            if (inputAuctionConfig === undefined) {
                const { auctionConfigId } = await this.fetchCustodian();
                return this.auctionConfigAddress(auctionConfigId + 1);
            } else {
                return inputAuctionConfig;
            }
        })();

        return this.program.methods
            .updateAuctionParameters()
            .accounts({
                owner,
                custodian: inputCustodian ?? this.custodianAddress(),
                proposal: inputProposal ?? (await this.proposalAddress()),
                auctionConfig,
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
            tokenRouterProgram,
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
                    true,
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
        chain: wormholeSdk.ChainId,
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
                    newFeeRecipient,
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

    async fetchCctpMintRecipient(): Promise<splToken.Account> {
        return splToken.getAccount(
            this.program.provider.connection,
            this.cctpMintRecipientAddress(),
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
            totalDeposit?: bigint;
        },
        feeOffer: bigint,
    ): Promise<[approveIx: TransactionInstruction, placeInitialOfferIx: TransactionInstruction]> {
        const {
            payer,
            fastVaa,
            offerToken: inputOfferToken,
            auction: inputAuction,
            auctionConfig: inputAuctionConfig,
            fromRouterEndpoint: inputFromRouterEndpoint,
            toRouterEndpoint: inputToRouterEndpoint,
            totalDeposit: inputTotalDeposit,
        } = accounts;

        const cctpMintRecipient = this.cctpMintRecipientAddress();

        const offerToken = await (async () => {
            if (inputOfferToken !== undefined) {
                return inputOfferToken;
            } else {
                return splToken.getAssociatedTokenAddressSync(this.mint, payer);
            }
        })();

        const { auction, fromRouterEndpoint, toRouterEndpoint, totalDeposit } = await (async () => {
            if (
                inputAuction === undefined ||
                inputFromRouterEndpoint === undefined ||
                inputToRouterEndpoint === undefined ||
                inputTotalDeposit === undefined
            ) {
                const vaaAccount = await VaaAccount.fetch(
                    this.program.provider.connection,
                    fastVaa,
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
                    totalDeposit: fastMarketOrder.amountIn + fastMarketOrder.maxFee,
                };
            } else {
                return {
                    auction: inputAuction,
                    fromRouterEndpoint: inputFromRouterEndpoint,
                    toRouterEndpoint: inputToRouterEndpoint,
                    totalDeposit: inputTotalDeposit,
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

        const approveIx = await this.approveCustodianIx(payer, totalDeposit);
        const placeInitialOfferIx = await this.program.methods
            .placeInitialOffer(new BN(feeOffer.toString()))
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                auctionConfig,
                auction,
                fromRouterEndpoint,
                toRouterEndpoint,
                offerToken,
                cctpMintRecipient,
                fastVaa,
            })
            .instruction();

        return [approveIx, placeInitialOfferIx];
    }

    async improveOfferIx(
        accounts: {
            auction: PublicKey;
            offerAuthority: PublicKey;
            auctionConfig?: PublicKey;
            bestOfferToken?: PublicKey;
        },
        feeOffer: bigint,
    ): Promise<[approveIx: TransactionInstruction, improveOfferIx: TransactionInstruction]> {
        const {
            offerAuthority,
            auction,
            auctionConfig: inputAuctionConfig,
            bestOfferToken: inputBestOfferToken,
        } = accounts;

        const { info } = await this.fetchAuction({ address: auction });
        if (info === null) {
            throw new Error("no auction info found");
        }
        const { auctionConfig, bestOfferToken } = await (async () => {
            if (inputAuctionConfig === undefined || inputBestOfferToken === undefined) {
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

        const approveIx = await this.approveCustodianIx(
            offerAuthority,
            info.amountIn.add(info.securityDeposit).toNumber(),
        );
        const improveOfferIx = await this.program.methods
            .improveOffer(new BN(feeOffer.toString()))
            .accounts({
                offerAuthority,
                custodian: this.custodianAddress(),
                auctionConfig,
                auction,
                offerToken: splToken.getAssociatedTokenAddressSync(this.mint, offerAuthority),
                bestOfferToken,
            })
            .instruction();

        return [approveIx, improveOfferIx];
    }

    async prepareOrderResponseCctpIx(
        accounts: {
            payer: PublicKey;
            fastVaa: PublicKey;
            finalizedVaa: PublicKey;
            mint?: PublicKey;
        },
        args: CctpMessageArgs,
    ): Promise<TransactionInstruction> {
        const { payer, fastVaa, finalizedVaa, mint: inputMint } = accounts;

        const fastVaaAcct = await VaaAccount.fetch(this.program.provider.connection, fastVaa);
        const { encodedCctpMessage } = args;
        const {
            authority: messageTransmitterAuthority,
            messageTransmitterConfig,
            usedNonces,
            messageTransmitterEventAuthority,
            tokenMessengerMinterProgram,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            tokenPair,
            custodyToken: tokenMessengerMinterCustodyToken,
            messageTransmitterProgram,
            tokenMessengerMinterEventAuthority,
        } = this.messageTransmitterProgram().receiveTokenMessengerMinterMessageAccounts(
            inputMint ?? this.mint,
            encodedCctpMessage,
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
                    fastVaaAcct.digest(),
                ),
                cctpMintRecipient: this.cctpMintRecipientAddress(),
                messageTransmitterAuthority,
                messageTransmitterConfig,
                usedNonces,
                messageTransmitterEventAuthority,
                tokenMessenger,
                remoteTokenMessenger,
                tokenMinter,
                localToken,
                tokenPair,
                tokenMessengerMinterCustodyToken,
                tokenMessengerMinterEventAuthority,
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
                cctpMintRecipient: this.cctpMintRecipientAddress(),
            })
            .instruction();
    }

    async settleAuctionActiveCctpIx(
        accounts: {
            payer: PublicKey;
            executorToken: PublicKey;
            preparedOrderResponse?: PublicKey;
            auction?: PublicKey;
            fastVaa: PublicKey;
            fastVaaAccount: VaaAccount;
            auctionConfig?: PublicKey;
            bestOfferToken?: PublicKey;
            encodedCctpMessage: Buffer;
        },
        args: { targetChain: wormholeSdk.ChainId; remoteDomain?: number },
    ) {
        const {
            payer,
            auction: inputAuction,
            executorToken,
            preparedOrderResponse,
            fastVaa,
            fastVaaAccount,
            auctionConfig: inputAuctionConfig,
            bestOfferToken: inputBestOfferToken,
            encodedCctpMessage,
        } = accounts;
        const auctionAddress = inputAuction ?? this.auctionAddress(fastVaaAccount.digest());

        const mint = this.mint;

        const { auctionConfig, bestOfferToken } = await (async () => {
            if (inputAuctionConfig === undefined || inputBestOfferToken === undefined) {
                const { info } = await this.fetchAuction({ address: auctionAddress });
                if (info === null) {
                    throw new Error("no auction info found");
                }
                const { configId, bestOfferToken } = info;
                return {
                    auctionConfig: inputAuctionConfig ?? this.auctionConfigAddress(configId),
                    bestOfferToken: inputBestOfferToken ?? bestOfferToken,
                };
            } else {
                return {
                    auctionConfig: inputAuctionConfig,
                    bestOfferToken: inputBestOfferToken,
                };
            }
        })();

        const targetChain = await (async () => {
            const message = LiquidityLayerMessage.decode(fastVaaAccount.payload());
            if (message.fastMarketOrder == undefined) {
                throw new Error("Message not FastMarketOrder");
            }

            const targetChain = message.fastMarketOrder.targetChain;

            return targetChain;
        })();

        const {
            protocol: { cctp },
        } = await this.fetchRouterEndpoint(targetChain);
        if (cctp === undefined) {
            throw new Error("CCTP domain is not undefined");
        }
        const destinationCctpDomain = cctp.domain;

        const routerEndpoint = this.routerEndpointAddress(targetChain);
        const {
            custodian,
            payerSequence,
            tokenMessengerMinterSenderAuthority,
            coreBridgeConfig,
            coreMessage,
            cctpMessage,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
            messageTransmitterConfig,
            tokenMessengerMinterProgram,
            tokenMinter,
            localToken,
            tokenMessenger,
            tokenMessengerMinterEventAuthority,
            messageTransmitterProgram,
        } = await this.burnAndPublishAccounts(
            { payer, mint },
            { targetChain, destinationCctpDomain },
        );

        return this.program.methods
            .settleAuctionActiveCctp()
            .accounts({
                payer,
                payerSequence,
                custodian,
                fastVaa,
                preparedOrderResponse,
                auction: auctionAddress,
                executorToken,
                cctpMintRecipient: this.cctpMintRecipientAddress(),
                auctionConfig,
                bestOfferToken,
                toRouterEndpoint: routerEndpoint,
                mint,
                messageTransmitterConfig,
                coreBridgeConfig,
                coreEmitterSequence,
                coreFeeCollector,
                coreMessage,
                cctpMessage,
                localToken,
                tokenMinter,
                tokenMessenger,
                tokenMessengerMinterProgram,
                tokenMessengerMinterSenderAuthority,
                remoteTokenMessenger:
                    this.tokenMessengerMinterProgram().remoteTokenMessengerAddress(
                        destinationCctpDomain,
                    ),
                tokenMessengerMinterEventAuthority,
                messageTransmitterProgram,
                coreBridgeProgram,
            })
            .instruction();
    }

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
        toRouterEndpoint?: PublicKey;
    }) {
        const { payer, fastVaa, preparedOrderResponse } = accounts;

        const fastVaaAccount = await VaaAccount.fetch(this.program.provider.connection, fastVaa);
        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        if (fastMarketOrder === undefined) {
            throw new Error("Message not FastMarketOrder");
        }

        const { targetChain } = fastMarketOrder;

        const {
            custodian,
            payerSequence,
            routerEndpoint: toRouterEndpoint,
            coreMessage,
            cctpMessage,
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
            tokenMessengerMinterEventAuthority,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        } = await this.burnAndPublishAccounts({ payer }, { targetChain });

        const { feeRecipientToken } = await this.fetchCustodian();

        return this.program.methods
            .settleAuctionNoneCctp()
            .accounts({
                payer,
                payerSequence,
                custodian,
                fastVaa,
                preparedOrderResponse,
                auction: this.auctionAddress(fastVaaAccount.digest()),
                cctpMintRecipient: this.cctpMintRecipientAddress(),
                feeRecipientToken,
                mint: this.mint,
                fromRouterEndpoint: this.routerEndpointAddress(fastVaaAccount.emitterInfo().chain),
                toRouterEndpoint,
                coreBridgeConfig,
                coreMessage,
                cctpMessage,
                coreEmitterSequence,
                coreFeeCollector,
                tokenMessengerMinterSenderAuthority,
                messageTransmitterConfig,
                tokenMessenger,
                remoteTokenMessenger,
                tokenMinter,
                localToken,
                tokenMessengerMinterEventAuthority,
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
            cctpMessage,
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
            tokenMessengerMinterEventAuthority,
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
                cctpMintRecipient: this.cctpMintRecipientAddress(),
                mint,
                payerSequence,
                coreBridgeConfig,
                coreMessage,
                cctpMessage,
                coreEmitterSequence,
                coreFeeCollector,
                tokenMessengerMinterSenderAuthority,
                messageTransmitterConfig,
                tokenMessenger,
                remoteTokenMessenger,
                tokenMinter,
                localToken,
                tokenMessengerMinterEventAuthority,
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

        const payerSequence = this.payerSequenceAddress(payer);
        const payerSequenceValue = await this.fetchPayerSequenceValue({
            address: payerSequence,
        });
        const {
            custodian,
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
        } = await this.publishMessageAccounts(payer, payerSequenceValue);

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
                cctpMintRecipient: this.cctpMintRecipientAddress(),
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
        vaa: PublicKey,
    ): Promise<{ vaaAccount: VaaAccount; accounts: RedeemFastFillAccounts }> {
        const vaaAccount = await VaaAccount.fetch(this.program.provider.connection, vaa);

        return {
            vaaAccount,
            accounts: {
                custodian: this.custodianAddress(),
                redeemedFastFill: this.redeemedFastFillAddress(vaaAccount.digest()),
                routerEndpoint: this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
                cctpMintRecipient: this.cctpMintRecipientAddress(),
                matchingEngineProgram: this.ID,
            },
        };
    }

    async publishMessageAccounts(
        payer: PublicKey,
        payerSequenceValue: BN | bigint,
    ): Promise<PublishMessageAccounts> {
        const coreMessage = this.coreMessageAddress(payer, payerSequenceValue);

        const coreBridgeProgram = this.coreBridgeProgramId();
        const custodian = this.custodianAddress();

        return {
            custodian,
            coreMessage,
            coreBridgeConfig: PublicKey.findProgramAddressSync(
                [Buffer.from("Bridge")],
                coreBridgeProgram,
            )[0],
            coreEmitterSequence: PublicKey.findProgramAddressSync(
                [Buffer.from("Sequence"), custodian.toBuffer()],
                coreBridgeProgram,
            )[0],
            coreFeeCollector: PublicKey.findProgramAddressSync(
                [Buffer.from("fee_collector")],
                coreBridgeProgram,
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
            destinationCctpDomain?: number;
        },
    ): Promise<BurnAndPublishAccounts> {
        const { payer, mint: inputMint } = base;
        const { targetChain, destinationCctpDomain: inputDestinationCctpDomain } = args;

        const destinationCctpDomain = await (async () => {
            if (inputDestinationCctpDomain === undefined) {
                const {
                    protocol: { cctp },
                } = await this.fetchRouterEndpoint(targetChain);
                if (cctp === undefined) {
                    throw new Error("not CCTP endpoint");
                }
                return cctp.domain;
            } else {
                return inputDestinationCctpDomain;
            }
        })();

        const {
            senderAuthority: tokenMessengerMinterSenderAuthority,
            messageTransmitterConfig,
            tokenMessenger,
            remoteTokenMessenger,
            tokenMinter,
            localToken,
            tokenMessengerMinterEventAuthority,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        } = this.tokenMessengerMinterProgram().depositForBurnWithCallerAccounts(
            inputMint ?? this.mint,
            destinationCctpDomain,
        );

        const payerSequence = this.payerSequenceAddress(payer);
        const payerSequenceValue = await this.fetchPayerSequenceValue({
            address: payerSequence,
        });
        const {
            custodian,
            coreMessage,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
        } = await this.publishMessageAccounts(payer, payerSequenceValue);

        return {
            custodian,
            payerSequence,
            routerEndpoint: this.routerEndpointAddress(targetChain),
            coreMessage,
            cctpMessage: this.cctpMessageAddress(payer, payerSequenceValue),
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
            tokenMessengerMinterEventAuthority,
            messageTransmitterProgram,
            tokenMessengerMinterProgram,
        };
    }

    tokenMessengerMinterProgram(): TokenMessengerMinterProgram {
        switch (this._programId) {
            case testnet(): {
                return new TokenMessengerMinterProgram(
                    this.program.provider.connection,
                    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3",
                );
            }
            case localnet(): {
                return new TokenMessengerMinterProgram(
                    this.program.provider.connection,
                    "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3",
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
                    "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd",
                );
            }
            case localnet(): {
                return new MessageTransmitterProgram(
                    this.program.provider.connection,
                    "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd",
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
        configId?: number,
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
        const auctionPenaltySlots = BigInt(auctionParams.penaltyPeriod);
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

    async computeMinOfferDelta(offerPrice: bigint): Promise<bigint> {
        const auctionParams = await this.fetchAuctionParameters();
        return (offerPrice * BigInt(auctionParams.minOfferDeltaBps)) / FEE_PRECISION_MAX;
    }
}

export function testnet(): ProgramId {
    return "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
}

export function localnet(): ProgramId {
    return "MatchingEngine11111111111111111111111111111";
}
