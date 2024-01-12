export * from "./state";

import { ChainId } from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { IDL, MatchingEngine } from "../../../target/types/matching_engine";
import { AuctionConfig, Custodian, RouterEndpoint } from "./state";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, getProgramData } from "../utils";
import { AuctionData } from "./state/AuctionData";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";

export const PROGRAM_IDS = ["MatchingEngine11111111111111111111111111111"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type AddRouterEndpointArgs = {
    chain: ChainId;
    address: Array<number>;
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

    async fetchPayerSequence(addr: PublicKey): Promise<BN> {
        return this.program.account.payerSequence
            .fetch(addr)
            .then((acct) => acct.value)
            .catch((_) => new BN(0));
    }

    routerEndpointAddress(chain: ChainId): PublicKey {
        return RouterEndpoint.address(this.ID, chain);
    }

    async fetchRouterEndpoint(addr: PublicKey): Promise<RouterEndpoint> {
        return this.program.account.routerEndpoint.fetch(addr);
    }

    auctionDataAddress(vaaHash: Buffer): PublicKey {
        return AuctionData.address(this.ID, vaaHash);
    }

    async fetchAuctionData(vaaHash: Buffer): Promise<AuctionData> {
        return this.program.account.auctionData.fetch(this.auctionDataAddress(vaaHash));
    }

    async initializeIx(
        auctionConfig: AuctionConfig,
        accounts: {
            owner: PublicKey;
            ownerAssistant: PublicKey;
            feeRecipient: PublicKey;
        }
    ): Promise<TransactionInstruction> {
        const { owner, ownerAssistant, feeRecipient } = accounts;

        return this.program.methods
            .initialize(auctionConfig)
            .accounts({
                owner,
                custodian: this.custodianAddress(),
                ownerAssistant,
                feeRecipient,
                custodyToken: this.custodyTokenAccountAddress(),
                mint: USDC_MINT_ADDRESS,
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

    async placeInitialOfferIx(
        feeOffer: bigint,
        fromChain: ChainId,
        toChain: ChainId,
        vaaHash: Buffer,
        accounts: { payer: PublicKey; vaa: PublicKey }
    ) {
        const { payer, vaa } = accounts;
        return this.program.methods
            .placeInitialOffer(new BN(feeOffer.toString()))
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                auctionData: this.auctionDataAddress(vaaHash),
                fromRouterEndpoint: this.routerEndpointAddress(fromChain),
                toRouterEndpoint: this.routerEndpointAddress(toChain),
                auctioneerToken: splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, payer),
                custodyToken: this.custodyTokenAccountAddress(),
                vaa,
            })
            .instruction();
    }
}

export function testnet(): ProgramId {
    return "MatchingEngine11111111111111111111111111111";
}
