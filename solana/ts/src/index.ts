export * from "./state";

import { ChainId } from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { IDL, TokenRouter } from "../../target/types/token_router";
import { Custodian, PayerSequence, RouterEndpoint } from "./state";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, getProgramData } from "./utils";
import {
    MessageTransmitterProgram,
    TokenMessengerMinterProgram,
    WormholeCctpProgram,
} from "./wormholeCctp";

export const PROGRAM_IDS = ["TokenRouter11111111111111111111111111111111"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type PlaceMarketOrderCctpArgs = {
    amountIn: bigint;
    targetChain: ChainId;
    redeemer: Array<number>;
    redeemerMessage: Buffer;
};

export type PublishMessageAccounts = {
    coreBridgeConfig: PublicKey;
    coreEmitterSequence: PublicKey;
    coreFeeCollector: PublicKey;
    coreBridgeProgram: PublicKey;
};

export type TokenRouterCommonAccounts = PublishMessageAccounts & {
    tokenRouterProgram: PublicKey;
    systemProgram: PublicKey;
    rent: PublicKey;
    custodian: PublicKey;
    custodyToken: PublicKey;
    tokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    tokenMessengerMinterSenderAuthority: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
    messageTransmitterAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenProgram: PublicKey;
    mint?: PublicKey;
    localToken?: PublicKey;
    tokenMessengerMinterCustodyToken?: PublicKey;
};

export type PlaceMarketOrderCctpAccounts = PublishMessageAccounts & {
    custodian: PublicKey;
    custodyToken: PublicKey;
    routerEndpoint: PublicKey;
    tokenMessengerMinterSenderAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    tokenMessenger: PublicKey;
    remoteTokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    localToken: PublicKey;
    coreBridgeProgram: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenProgram: PublicKey;
};

export type AddRouterEndpointArgs = {
    chain: ChainId;
    address: Array<number>;
    cctpDomain: number | null;
};

export type RegisterContractArgs = {
    chain: ChainId;
    address: Array<number>;
};

export type RegisterAssetArgs = {
    chain: ChainId;
    relayerFee: BN;
    nativeSwapRate: BN;
    maxNativeSwapAmount: BN;
};

export type UpdateRelayerFeeArgs = {
    chain: ChainId;
    relayerFee: BN;
};

export class TokenRouterProgram {
    private _programId: ProgramId;

    program: Program<TokenRouter>;

    // TODO: fix this
    constructor(connection: Connection, programId?: ProgramId) {
        this._programId = programId ?? testnet();
        this.program = new Program(IDL, new PublicKey(this._programId), {
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

    coreMessageAddress(payer: PublicKey, payerSequenceValue: BN): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("msg"), payer.toBuffer(), payerSequenceValue.toBuffer("be", 8)],
            this.ID
        )[0];
    }

    payerSequenceAddress(payer: PublicKey): PublicKey {
        return PayerSequence.address(this.ID, payer);
    }

    async fetchPayerSequence(addr: PublicKey): Promise<PayerSequence> {
        return this.program.account.payerSequence.fetch(addr);
    }

    async fetchPayerSequenceValue(addr: PublicKey): Promise<BN> {
        return this.fetchPayerSequence(addr)
            .then((acct) => acct.value)
            .catch((_) => new BN(0));
    }

    routerEndpointAddress(chain: ChainId): PublicKey {
        return RouterEndpoint.address(this.ID, chain);
    }

    async fetchRouterEndpoint(addr: PublicKey): Promise<RouterEndpoint> {
        return this.program.account.routerEndpoint.fetch(addr);
    }

    async placeMarketOrderCctpAccounts(
        mint: PublicKey,
        targetChain: ChainId,
        overrides: {
            remoteDomain?: number;
        } = {}
    ): Promise<PlaceMarketOrderCctpAccounts> {
        const { remoteDomain: inputRemoteDomain } = overrides;

        const routerEndpoint = this.routerEndpointAddress(targetChain);
        const remoteDomain = await (async () => {
            if (inputRemoteDomain !== undefined) {
                return inputRemoteDomain;
            } else {
                const cctpDomain = await this.fetchRouterEndpoint(routerEndpoint).then(
                    (acct) => acct.cctpDomain
                );
                if (cctpDomain === null) {
                    throw new Error("invalid router endpoint");
                } else {
                    return cctpDomain;
                }
            }
        })();

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

        return {
            custodian,
            custodyToken: this.custodyTokenAccountAddress(),
            routerEndpoint,
            coreBridgeConfig,
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
        };
    }

    async placeMarketOrderCctpIx(
        accounts: {
            payer: PublicKey;
            mint: PublicKey;
            burnSource: PublicKey;
            burnSourceAuthority?: PublicKey;
        },
        args: PlaceMarketOrderCctpArgs
    ): Promise<TransactionInstruction> {
        let { payer, burnSource, mint, burnSourceAuthority: inputBurnSourceAuthority } = accounts;
        const burnSourceAuthority =
            inputBurnSourceAuthority ??
            (await splToken
                .getAccount(this.program.provider.connection, burnSource)
                .then((token) => token.owner));

        const { amountIn, targetChain, redeemer, redeemerMessage } = args;

        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue(payerSequence).then((value) =>
            this.coreMessageAddress(payer, value)
        );
        const {
            custodian,
            custodyToken,
            routerEndpoint,
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
            tokenMessengerMinterProgram,
            messageTransmitterProgram,
            tokenProgram,
        } = await this.placeMarketOrderCctpAccounts(mint, targetChain);

        return this.program.methods
            .placeMarketOrderCctp({
                amountIn: new BN(amountIn.toString()),
                redeemer,
                redeemerMessage,
            })
            .accounts({
                payer,
                payerSequence,
                custodian,
                burnSourceAuthority,
                mint,
                burnSource,
                custodyToken,
                routerEndpoint,
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

    async initializeIx(accounts: {
        owner: PublicKey;
        ownerAssistant: PublicKey;
        mint: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, ownerAssistant, mint } = accounts;
        return this.program.methods
            .initialize()
            .accounts({
                owner,
                custodian: this.custodianAddress(),
                ownerAssistant,
                mint,
                custodyToken: this.custodyTokenAccountAddress(),
            })
            .instruction();
    }

    async setPauseIx(
        accounts: {
            ownerOrAssistant: PublicKey;
            custodian?: PublicKey;
        },
        paused: boolean
    ): Promise<TransactionInstruction> {
        const { ownerOrAssistant, custodian: inputCustodian } = accounts;
        return this.program.methods
            .setPause(paused)
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
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

    async addRouterEndpointIx(
        accounts: {
            ownerOrAssistant: PublicKey;
            custodian?: PublicKey;
            routerEndpoint?: PublicKey;
            remoteTokenMessenger?: PublicKey;
        },
        args: AddRouterEndpointArgs
    ): Promise<TransactionInstruction> {
        const {
            ownerOrAssistant,
            custodian: inputCustodian,
            routerEndpoint: inputRouterEndpoint,
            remoteTokenMessenger: inputRemoteTokenMessenger,
        } = accounts;
        const { chain, cctpDomain } = args;
        const derivedRemoteTokenMessenger =
            cctpDomain === null
                ? null
                : this.tokenMessengerMinterProgram().remoteTokenMessengerAddress(cctpDomain);
        return this.program.methods
            .addRouterEndpoint(args)
            .accounts({
                ownerOrAssistant,
                custodian: inputCustodian ?? this.custodianAddress(),
                routerEndpoint: inputRouterEndpoint ?? this.routerEndpointAddress(chain),
                remoteTokenMessenger: inputRemoteTokenMessenger ?? derivedRemoteTokenMessenger,
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
    return "TokenRouter11111111111111111111111111111111";
}

export function mainnet(): ProgramId {
    return "TokenRouter11111111111111111111111111111111";
}
