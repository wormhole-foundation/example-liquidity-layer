export * from "./state/";

import { ChainId } from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import IDL from "../../../target/idl/matching_engine.json";
import { MatchingEngine } from "../../../target/types/matching_engine";
import { AuctionConfig, Custodian } from "./state";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, getProgramData } from "../utils";
import { WormholeCctpProgram } from "../wormholeCctp";

export const PROGRAM_IDS = ["MatchingEngine11111111111111111111111111111"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type AddRouterEndpointArgs = {
    chain: ChainId;
    address: Array<number>;
};

export class MatchingEngineProgram {
    private _programId: ProgramId;

    program: Program<MatchingEngine>;

    // TODO: fix this
    constructor(connection: Connection, programId?: ProgramId) {
        this._programId = programId ?? testnet();
        this.program = new Program(IDL as any, new PublicKey(this._programId), {
            connection,
        });
    }

    get ID(): PublicKey {
        return this.program.programId;
    }

    wormholeCctpProgram(): WormholeCctpProgram {
        switch (this._programId) {
            case testnet(): {
                return new WormholeCctpProgram(
                    this.program.provider.connection,
                    "wCCTPvsyeL9qYqbHTv3DUAyzEfYcyHoYw5c4mgcbBeW"
                );
            }
            default: {
                throw new Error("unsupported network");
            }
        }
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

    // routerEndpointAddress(chain: ChainId): PublicKey {
    //     return RouterEndpoint.address(this.ID, chain);
    // }

    // async fetchRouterEndpoint(addr: PublicKey): Promise<RouterEndpoint> {
    //     return this.program.account.routerEndpoint.fetch(addr);
    // }

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
                programData: getProgramData(this.ID),
                bpfLoaderUpgradeableProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            })
            .instruction();
    }

    // async addRouterEndpointIx(
    //     accounts: {
    //         ownerOrAssistant: PublicKey;
    //         custodian?: PublicKey;
    //         routerEndpoint?: PublicKey;
    //     },
    //     args: AddRouterEndpointArgs
    // ): Promise<TransactionInstruction> {
    //     const {
    //         ownerOrAssistant,
    //         custodian: inputCustodian,
    //         routerEndpoint: inputRouterEndpoint,
    //     } = accounts;
    //     const { chain } = args;
    //     return this.program.methods
    //         .addRouterEndpoint(args)
    //         .accounts({
    //             ownerOrAssistant,
    //             custodian: inputCustodian ?? this.custodianAddress(),
    //             routerEndpoint: inputRouterEndpoint ?? this.routerEndpointAddress(chain),
    //         })
    //         .instruction();
    // }
}

export function testnet(): ProgramId {
    return "MatchingEngine11111111111111111111111111111";
}
