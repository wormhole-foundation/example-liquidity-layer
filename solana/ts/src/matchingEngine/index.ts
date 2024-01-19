export * from "./state";

import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { IDL, MatchingEngine } from "../../../target/types/matching_engine";
import { AuctionConfig, Custodian, RouterEndpoint, PayerSequence, RedeemedFastFill } from "./state";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, getProgramData } from "../utils";
import { AuctionData } from "./state/AuctionData";
import { TokenMessengerMinterProgram } from "../cctp";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";
import { VaaAccount } from "../wormhole";

export const PROGRAM_IDS = ["MatchingEngine11111111111111111111111111111"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type AddRouterEndpointArgs = {
    chain: wormholeSdk.ChainId;
    address: Array<number>;
    mintRecipient: Array<number> | null;
};

export type PublishMessageAccounts = {
    coreBridgeConfig: PublicKey;
    coreEmitterSequence: PublicKey;
    coreFeeCollector: PublicKey;
    coreBridgeProgram: PublicKey;
};

export type RedeemFastFillAccounts = {
    custodian: PublicKey;
    redeemedFastFill: PublicKey;
    routerEndpoint: PublicKey;
    custodyToken: PublicKey;
    matchingEngineProgram: PublicKey;
    tokenProgram: PublicKey;
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

    auctionDataAddress(vaaHash: Buffer | Uint8Array): PublicKey {
        return AuctionData.address(this.ID, vaaHash);
    }

    async fetchAuctionData(vaaHash: Buffer | Uint8Array): Promise<AuctionData> {
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

    redeemedFastFillAddress(vaaHash: Buffer | Uint8Array): PublicKey {
        return RedeemedFastFill.address(this.ID, vaaHash);
    }

    fetchRedeemedFastFill(addr: PublicKey): Promise<RedeemedFastFill> {
        return this.program.account.redeemedFastFill.fetch(addr);
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
    ) {
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
        accounts: { offerAuthority: PublicKey; bestOfferToken: PublicKey }
    ) {
        const { offerAuthority, bestOfferToken } = accounts;
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

    async executeFastOrderIx(
        toChain: wormholeSdk.ChainId,
        remoteDomain: number,
        vaaHash: Buffer,
        accounts: {
            payer: PublicKey;
            vaa: PublicKey;
            bestOfferToken: PublicKey;
            initialOfferToken: PublicKey;
        }
    ) {
        const { payer, vaa, bestOfferToken, initialOfferToken } = accounts;
        const { mint } = await splToken.getAccount(
            this.program.provider.connection,
            bestOfferToken
        );
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
        } = this.tokenMessengerMinterProgram().depositForBurnWithCallerAccounts(mint, remoteDomain);

        const custodian = this.custodianAddress();
        const { coreBridgeConfig, coreEmitterSequence, coreFeeCollector, coreBridgeProgram } =
            this.publishMessageAccounts(custodian);
        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue(payerSequence).then((value) =>
            this.coreMessageAddress(payer, value)
        );

        return this.program.methods
            .executeFastOrder()
            .accounts({
                payer,
                custodian,
                auctionData: this.auctionDataAddress(vaaHash),
                toRouterEndpoint: this.routerEndpointAddress(toChain),
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
            bestOfferToken: PublicKey;
            initialOfferToken: PublicKey;
        }
    ) {
        const { payer, vaa, bestOfferToken, initialOfferToken } = accounts;
        const { mint } = await splToken.getAccount(
            this.program.provider.connection,
            bestOfferToken
        );

        const custodian = this.custodianAddress();
        const { coreBridgeConfig, coreEmitterSequence, coreFeeCollector, coreBridgeProgram } =
            this.publishMessageAccounts(custodian);
        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue(payerSequence).then((value) =>
            this.coreMessageAddress(payer, value)
        );

        return this.program.methods
            .executeFastOrderSolana()
            .accounts({
                payer,
                custodian,
                auctionData: this.auctionDataAddress(vaaHash),
                toRouterEndpoint: this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
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

    async redeemFastFillAccounts(vaa: PublicKey): Promise<RedeemFastFillAccounts> {
        const custodyToken = this.custodyTokenAccountAddress();
        const vaaAcct = await VaaAccount.fetch(this.program.provider.connection, vaa);

        return {
            custodian: this.custodianAddress(),
            redeemedFastFill: this.redeemedFastFillAddress(vaaAcct.digest()),
            routerEndpoint: this.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA),
            custodyToken,
            matchingEngineProgram: this.ID,
            tokenProgram: splToken.TOKEN_PROGRAM_ID,
        };
    }

    publishMessageAccounts(emitter: PublicKey): PublishMessageAccounts {
        const coreBridgeProgram = this.coreBridgeProgramId();

        return {
            coreBridgeConfig: PublicKey.findProgramAddressSync(
                [Buffer.from("Bridge")],
                coreBridgeProgram
            )[0],
            coreEmitterSequence: PublicKey.findProgramAddressSync(
                [Buffer.from("Sequence"), emitter.toBuffer()],
                coreBridgeProgram
            )[0],
            coreFeeCollector: PublicKey.findProgramAddressSync(
                [Buffer.from("fee_collector")],
                coreBridgeProgram
            )[0],
            coreBridgeProgram,
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
