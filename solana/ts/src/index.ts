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

export type TransferTokensWithRelayArgs = {
    amount: BN;
    toNativeTokenAmount: BN;
    targetChain: ChainId;
    targetRecipientWallet: Array<number>;
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

    payerSequenceAddress(payer: PublicKey): PublicKey {
        return PayerSequence.address(this.ID, payer);
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

    // async transferTokensWithRelayIx(
    //     accounts: {
    //         payer: PublicKey;
    //         fromToken: PublicKey;
    //         mint?: PublicKey;
    //         custodian?: PublicKey;
    //         registeredContract?: PublicKey;
    //     },
    //     args: TransferTokensWithRelayArgs
    // ): Promise<TransactionInstruction> {
    //     const connection = this.program.provider.connection;

    //     const {
    //         payer,
    //         fromToken,
    //         mint: inputMint,
    //         custodian: inputCustodian,
    //         registeredContract: inputRegisteredContract,
    //     } = accounts;
    //     const { amount, toNativeTokenAmount, targetChain, targetRecipientWallet } = args;
    //     const mint = await (async () => {
    //         if (inputMint === undefined) {
    //             return splToken.getAccount(connection, fromToken).then((acct) => acct.mint);
    //         } else {
    //             return inputMint;
    //         }
    //     })();

    //     // Fetch the signer sequence.
    //     const payerSequence = this.payerSequenceAddress(payer);
    //     const [coreMessage] = await this.program.account.payerSequence
    //         .fetch(payerSequence)
    //         .then((acct) => acct.value)
    //         .catch(() => new BN(0))
    //         .then((seq) =>
    //             PublicKey.findProgramAddressSync(
    //                 [Buffer.from("msg"), payer.toBuffer(), seq.toBuffer("be", 8)],
    //                 this.ID
    //             )
    //         );

    //     const wormholeCctp = this.wormholeCctpProgram();
    //     const {
    //         custodian: wormCctpCustodian,
    //         custodyToken: wormCctpCustodyToken,
    //         registeredEmitter: wormCctpRegisteredEmitter,
    //         coreBridgeConfig,
    //         coreEmitterSequence,
    //         coreFeeCollector,
    //         tokenMessengerMinterSenderAuthority: cctpTokenMessengerMinterSenderAuthority,
    //         messageTransmitterConfig: cctpMessageTransmitterConfig,
    //         tokenMessenger: cctpTokenMessenger,
    //         remoteTokenMessenger: cctpRemoteTokenMessenger,
    //         tokenMinter: cctpTokenMinter,
    //         localToken: cctpLocalToken,
    //         tokenProgram,
    //         coreBridgeProgram,
    //         tokenMessengerMinterProgram: cctpTokenMessengerMinterProgram,
    //         messageTransmitterProgram: cctpMessageTransmitterProgram,
    //     } = await wormholeCctp.transferTokensWithPayloadAccounts(mint, targetChain);

    //     return this.program.methods
    //         .transferTokensWithRelay({ amount, toNativeTokenAmount, targetRecipientWallet })
    //         .accounts({
    //             payer,
    //             custodian: inputCustodian ?? this.custodianAddress(),
    //             payerSequence,
    //             registeredContract:
    //                 inputRegisteredContract ?? this.registeredContractAddress(targetChain),
    //             mint,
    //             fromToken,
    //             coreMessage,
    //             custodyToken: this.custodyTokenAccountAddress(),
    //             wormCctpCustodian,
    //             wormCctpCustodyToken,
    //             wormCctpRegisteredEmitter,
    //             coreBridgeConfig,
    //             coreEmitterSequence,
    //             coreFeeCollector,
    //             cctpTokenMessengerMinterSenderAuthority,
    //             cctpMessageTransmitterConfig,
    //             cctpTokenMessenger,
    //             cctpRemoteTokenMessenger,
    //             cctpTokenMinter,
    //             cctpLocalToken,
    //             tokenProgram,
    //             wormholeCctpProgram: wormholeCctp.ID,
    //             coreBridgeProgram,
    //             cctpTokenMessengerMinterProgram,
    //             cctpMessageTransmitterProgram,
    //         })
    //         .instruction();
    // }

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
