export * from "./state";

import { Program } from "@coral-xyz/anchor";
import {
    Connection,
    PublicKey,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    TransactionInstruction,
} from "@solana/web3.js";
import { IDL, UpgradeManager } from "../../../target/types/upgrade_manager";
import * as matchingEngineSdk from "../matchingEngine";
import * as tokenRouterSdk from "../tokenRouter";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, programDataAddress } from "../utils";
import { UpgradeReceipt } from "./state";

export const PROGRAM_IDS = [
    "UpgradeManager11111111111111111111111111111",
    "ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt",
] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export class UpgradeManagerProgram {
    private _programId: ProgramId;

    program: Program<UpgradeManager>;

    constructor(connection: Connection, programId: ProgramId) {
        this._programId = programId;
        this.program = new Program(IDL as any, new PublicKey(this._programId), {
            connection,
        });
    }

    get ID(): PublicKey {
        return this.program.programId;
    }

    upgradeAuthorityAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("upgrade")], this.ID)[0];
    }

    upgradeReceiptAddress(otherProgram: PublicKey): PublicKey {
        return UpgradeReceipt.address(this.ID, otherProgram);
    }

    async fetchUpgradeReceipt(input: PublicKey | { address: PublicKey }): Promise<UpgradeReceipt> {
        const addr = "address" in input ? input.address : this.upgradeReceiptAddress(input);
        return this.program.account.upgradeReceipt.fetch(addr);
    }

    async upgradeMatchingEngineIx(accounts: {
        owner: PublicKey;
        matchingEngineBuffer: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, matchingEngineBuffer } = accounts;

        const matchingEngine = this.matchingEngineProgram();
        return this.program.methods
            .upgradeMatchingEngine()
            .accounts({
                owner,
                programData: programDataAddress(this.ID),
                upgradeAuthority: this.upgradeAuthorityAddress(),
                matchingEngineBuffer,
                matchingEngineProgramData: programDataAddress(matchingEngine.ID),
                matchingEngineProgram: matchingEngine.ID,
                bpfLoaderUpgradeableProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            })
            .instruction();
    }

    async executeTokenRouterUpgradeIx(accounts: {
        owner: PublicKey;
        tokenRouterBuffer: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, tokenRouterBuffer } = accounts;

        const tokenRouter = this.tokenRouterProgram();
        return this.program.methods
            .executeTokenRouterUpgrade()
            .accounts({
                owner,
                upgradeAuthority: this.upgradeAuthorityAddress(),
                upgradeReceipt: this.upgradeReceiptAddress(tokenRouter.ID),
                tokenRouterBuffer,
                tokenRouterProgramData: programDataAddress(tokenRouter.ID),
                tokenRouterCustodian: tokenRouter.custodianAddress(),
                tokenRouterProgram: tokenRouter.ID,
                bpfLoaderUpgradeableProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            })
            .instruction();
    }

    matchingEngineProgram(): matchingEngineSdk.MatchingEngineProgram {
        switch (this._programId) {
            case testnet(): {
                return new matchingEngineSdk.MatchingEngineProgram(
                    this.program.provider.connection,
                    matchingEngineSdk.testnet(),
                    PublicKey.default,
                );
            }
            case localnet(): {
                return new matchingEngineSdk.MatchingEngineProgram(
                    this.program.provider.connection,
                    matchingEngineSdk.localnet(),
                    PublicKey.default,
                );
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }

    tokenRouterProgram(): tokenRouterSdk.TokenRouterProgram {
        switch (this._programId) {
            case testnet(): {
                return new tokenRouterSdk.TokenRouterProgram(
                    this.program.provider.connection,
                    tokenRouterSdk.testnet(),
                    PublicKey.default,
                );
            }
            case localnet(): {
                return new tokenRouterSdk.TokenRouterProgram(
                    this.program.provider.connection,
                    tokenRouterSdk.localnet(),
                    PublicKey.default,
                );
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }
}

export function testnet(): ProgramId {
    return "ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt";
}

export function localnet(): ProgramId {
    return "UpgradeManager11111111111111111111111111111";
}
