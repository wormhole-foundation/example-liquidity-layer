export * from "./state";

import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    Connection,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { IDL, TokenRouter } from "../../../target/types/token_router";
import {
    CctpTokenBurnMessage,
    MessageTransmitterProgram,
    TokenMessengerMinterProgram,
} from "../cctp";
import * as matchingEngineSdk from "../matchingEngine";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, getProgramData } from "../utils";
import { VaaAccount } from "../wormhole";
import { Custodian, PayerSequence, PreparedFill, PreparedOrder } from "./state";

export const PROGRAM_IDS = [
    "TokenRouter11111111111111111111111111111111",
    "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md",
] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type PrepareMarketOrderArgs = {
    amountIn: bigint;
    minAmountOut: bigint | null;
    targetChain: number;
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
    mint: PublicKey;
    localToken: PublicKey;
    tokenMessengerMinterCustodyToken: PublicKey;
};

export type PlaceMarketOrderCctpAccounts = PublishMessageAccounts & {
    custodian: PublicKey;
    custodyToken: PublicKey;
    mint: PublicKey;
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

export type RedeemFillCctpAccounts = {
    custodian: PublicKey;
    preparedFill: PublicKey;
    custodyToken: PublicKey;
    routerEndpoint: PublicKey;
    messageTransmitterAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    usedNonces: PublicKey;
    tokenMessenger: PublicKey;
    remoteTokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    localToken: PublicKey;
    tokenPair: PublicKey;
    tokenMessengerMinterCustodyToken: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenProgram: PublicKey;
};

export type RedeemFastFillAccounts = {
    custodian: PublicKey;
    preparedFill: PublicKey;
    custodyToken: PublicKey;
    matchingEngineCustodian: PublicKey;
    matchingEngineRedeemedFastFill: PublicKey;
    matchingEngineRouterEndpoint: PublicKey;
    matchingEngineCustodyToken: PublicKey;
    matchingEngineProgram: PublicKey;
};

export type AddCctpRouterEndpointArgs = {
    chain: number;
    cctpDomain: number;
    address: Array<number>;
    mintRecipient: Array<number> | null;
};

export class TokenRouterProgram {
    private _programId: ProgramId;
    private _mint: PublicKey;

    program: Program<TokenRouter>;

    // TODO: fix this
    constructor(connection: Connection, programId: ProgramId, mint: PublicKey) {
        this._programId = programId;
        this._mint = mint;
        this.program = new Program(IDL, new PublicKey(this._programId), {
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

    custodyTokenAccountAddress(): PublicKey {
        return splToken.getAssociatedTokenAddressSync(this.mint, this.custodianAddress(), true);
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

    async fetchPreparedOrder(addr: PublicKey): Promise<PreparedOrder> {
        return this.program.account.preparedOrder.fetch(addr);
    }

    preparedFillAddress(vaaHash: Array<number> | Uint8Array | Buffer) {
        return PreparedFill.address(this.ID, vaaHash);
    }

    // TODO: fix
    async fetchPreparedFill(addr: PublicKey): Promise<PreparedFill> {
        return this.program.account.preparedFill.fetch(addr);
    }

    async commonAccounts(): Promise<TokenRouterCommonAccounts> {
        const custodian = this.custodianAddress();
        const { coreBridgeConfig, coreEmitterSequence, coreFeeCollector, coreBridgeProgram } =
            this.publishMessageAccounts(custodian);

        const tokenMessengerMinterProgram = this.tokenMessengerMinterProgram();
        const messageTransmitterProgram = this.messageTransmitterProgram();

        const custodyToken = this.custodyTokenAccountAddress();
        const mint = this.mint;

        return {
            tokenRouterProgram: this.ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            custodian,
            custodyToken,
            coreBridgeConfig,
            coreEmitterSequence,
            coreFeeCollector,
            coreBridgeProgram,
            tokenMessenger: tokenMessengerMinterProgram.tokenMessengerAddress(),
            tokenMinter: tokenMessengerMinterProgram.tokenMinterAddress(),
            tokenMessengerMinterSenderAuthority: tokenMessengerMinterProgram.senderAuthority(),
            tokenMessengerMinterProgram: tokenMessengerMinterProgram.ID,
            messageTransmitterAuthority: messageTransmitterProgram.authorityAddress(),
            messageTransmitterConfig: messageTransmitterProgram.messageTransmitterConfigAddress(),
            messageTransmitterProgram: messageTransmitterProgram.ID,
            tokenProgram: splToken.TOKEN_PROGRAM_ID,
            mint,
            localToken: tokenMessengerMinterProgram.localTokenAddress(mint),
            tokenMessengerMinterCustodyToken: tokenMessengerMinterProgram.custodyTokenAddress(mint),
        };
    }

    async prepareMarketOrderIx(
        accounts: {
            payer: PublicKey;
            orderSender: PublicKey;
            preparedOrder: PublicKey;
            orderToken: PublicKey;
            refundToken: PublicKey;
        },
        args: PrepareMarketOrderArgs
    ): Promise<TransactionInstruction> {
        const { payer, orderSender, preparedOrder, orderToken, refundToken } = accounts;
        const { amountIn, minAmountOut, ...remainingArgs } = args;

        return this.program.methods
            .prepareMarketOrder({
                amountIn: new BN(amountIn.toString()),
                minAmountOut: minAmountOut === null ? null : new BN(minAmountOut.toString()),
                ...remainingArgs,
            })
            .accounts({
                payer,
                custodian: this.custodianAddress(),
                orderSender,
                preparedOrder,
                orderToken,
                refundToken,
                custodyToken: this.custodyTokenAccountAddress(),
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            })
            .instruction();
    }

    async closePreparedOrderIx(accounts: {
        preparedOrder: PublicKey;
        preparedBy?: PublicKey;
        orderSender?: PublicKey;
        refundToken?: PublicKey;
    }): Promise<TransactionInstruction> {
        const {
            preparedOrder,
            preparedBy: inputPreparedBy,
            orderSender: inputOrderSender,
            refundToken: inputRefundToken,
        } = accounts;

        const { preparedBy, orderSender, refundToken } = await (async () => {
            if (
                inputPreparedBy === undefined ||
                inputOrderSender === undefined ||
                inputRefundToken === undefined
            ) {
                const {
                    info: { preparedBy, orderSender, refundToken },
                } = await this.fetchPreparedOrder(preparedOrder);

                return {
                    preparedBy: inputPreparedBy ?? preparedBy,
                    orderSender: inputOrderSender ?? orderSender,
                    refundToken: inputRefundToken ?? refundToken,
                };
            } else {
                return {
                    preparedBy: inputPreparedBy,
                    orderSender: inputOrderSender,
                    refundToken: inputRefundToken,
                };
            }
        })();

        return this.program.methods
            .closePreparedOrder()
            .accounts({
                preparedBy,
                custodian: this.custodianAddress(),
                orderSender,
                preparedOrder,
                refundToken,
                custodyToken: this.custodyTokenAccountAddress(),
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            })
            .instruction();
    }

    async consumePreparedFillIx(accounts: {
        preparedFill: PublicKey;
        redeemer: PublicKey;
        dstToken: PublicKey;
        rentRecipient: PublicKey;
    }): Promise<TransactionInstruction> {
        const { preparedFill, redeemer, dstToken, rentRecipient } = accounts;

        return this.program.methods
            .consumePreparedFill()
            .accounts({
                custodian: this.custodianAddress(),
                redeemer,
                rentRecipient,
                preparedFill,
                dstToken,
                custodyToken: this.custodyTokenAccountAddress(),
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            })
            .instruction();
    }

    async placeMarketOrderCctpAccounts(
        targetChain: number,
        overrides: {
            remoteDomain?: number;
        } = {}
    ): Promise<PlaceMarketOrderCctpAccounts> {
        const { remoteDomain: inputRemoteDomain } = overrides;

        const matchingEngine = this.matchingEngineProgram();
        const routerEndpoint = matchingEngine.routerEndpointAddress(targetChain);
        const remoteDomain = await (async () => {
            if (inputRemoteDomain !== undefined) {
                return inputRemoteDomain;
            } else {
                const { protocol } = await matchingEngine.fetchRouterEndpoint({
                    address: routerEndpoint,
                });
                if (protocol.cctp !== undefined) {
                    return protocol.cctp.domain;
                } else {
                    throw new Error("invalid router endpoint");
                }
            }
        })();

        const custodyToken = this.custodyTokenAccountAddress();
        const mint = this.mint;

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
            custodyToken,
            mint,
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
            preparedOrder: PublicKey;
            orderSender?: PublicKey;
            routerEndpoint?: PublicKey;
        },
        args?: {
            targetChain: number;
        }
    ): Promise<TransactionInstruction> {
        const {
            payer,
            preparedOrder,
            orderSender: inputOrderSender,
            routerEndpoint: inputRouterEndpoint,
        } = accounts;
        const { orderSender, targetChain } = await (async () => {
            if (inputOrderSender === undefined || args === undefined) {
                const {
                    info: { orderSender, targetChain },
                } = await this.fetchPreparedOrder(preparedOrder).catch((_) => {
                    throw new Error(
                        "Cannot find prepared order. If it doesn't exist, please provide orderSender and targetChain."
                    );
                });
                return { orderSender, targetChain };
            } else {
                return { orderSender: inputOrderSender, targetChain: args.targetChain };
            }
        })();

        const payerSequence = this.payerSequenceAddress(payer);
        const coreMessage = await this.fetchPayerSequenceValue(payerSequence).then((value) =>
            this.coreMessageAddress(payer, value)
        );
        const {
            custodian,
            custodyToken,
            mint,
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
        } = await this.placeMarketOrderCctpAccounts(targetChain);

        return this.program.methods
            .placeMarketOrderCctp()
            .accounts({
                payer,
                payerSequence,
                custodian,
                preparedOrder,
                orderSender: inputOrderSender ?? orderSender,
                mint,
                custodyToken,
                routerEndpoint: inputRouterEndpoint ?? routerEndpoint,
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

    async redeemCctpFillAccounts(
        vaa: PublicKey,
        cctpMessage: CctpTokenBurnMessage | Buffer
    ): Promise<RedeemFillCctpAccounts> {
        const msg = CctpTokenBurnMessage.from(cctpMessage);
        const custodyToken = this.custodyTokenAccountAddress();

        const vaaAcct = await VaaAccount.fetch(this.program.provider.connection, vaa);
        const { chain } = vaaAcct.emitterInfo();
        const preparedFill = this.preparedFillAddress(vaaAcct.digest());

        const messageTransmitterProgram = this.messageTransmitterProgram();
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
            tokenProgram,
        } = messageTransmitterProgram.receiveMessageAccounts(this.mint, msg);

        return {
            custodian: this.custodianAddress(),
            preparedFill,
            custodyToken,
            routerEndpoint: this.matchingEngineProgram().routerEndpointAddress(chain),
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
            messageTransmitterProgram: messageTransmitterProgram.ID,
            tokenProgram,
        };
    }

    async redeemCctpFillIx(
        accounts: {
            payer: PublicKey;
            vaa: PublicKey;
            routerEndpoint?: PublicKey;
        },
        args: {
            encodedCctpMessage: Buffer;
            cctpAttestation: Buffer;
        }
    ): Promise<TransactionInstruction> {
        const { payer, vaa, routerEndpoint: inputRouterEndpoint } = accounts;

        const { encodedCctpMessage } = args;

        const {
            custodian,
            preparedFill,
            custodyToken,
            routerEndpoint,
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
        } = await this.redeemCctpFillAccounts(vaa, encodedCctpMessage);

        return this.program.methods
            .redeemCctpFill(args)
            .accounts({
                payer,
                custodian,
                vaa,
                preparedFill,
                custodyToken,
                routerEndpoint: inputRouterEndpoint ?? routerEndpoint,
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

    async redeemFastFillAccounts(vaa: PublicKey): Promise<RedeemFastFillAccounts> {
        const {
            vaaAccount,
            accounts: {
                custodian: matchingEngineCustodian,
                redeemedFastFill: matchingEngineRedeemedFastFill,
                routerEndpoint: matchingEngineRouterEndpoint,
                custodyToken: matchingEngineCustodyToken,
                matchingEngineProgram,
            },
        } = await this.matchingEngineProgram().redeemFastFillAccounts(vaa);

        return {
            custodian: this.custodianAddress(),
            preparedFill: this.preparedFillAddress(vaaAccount.digest()),
            custodyToken: this.custodyTokenAccountAddress(),
            matchingEngineCustodian,
            matchingEngineRedeemedFastFill,
            matchingEngineRouterEndpoint,
            matchingEngineCustodyToken,
            matchingEngineProgram,
        };
    }

    async redeemFastFillIx(accounts: {
        payer: PublicKey;
        vaa: PublicKey;
    }): Promise<TransactionInstruction> {
        const { payer, vaa } = accounts;
        const {
            custodian,
            preparedFill,
            custodyToken,
            matchingEngineCustodian,
            matchingEngineRedeemedFastFill,
            matchingEngineRouterEndpoint,
            matchingEngineCustodyToken,
            matchingEngineProgram,
        } = await this.redeemFastFillAccounts(vaa);

        return this.program.methods
            .redeemFastFill()
            .accounts({
                payer,
                custodian,
                vaa,
                preparedFill,
                custodyToken,
                matchingEngineCustodian,
                matchingEngineRedeemedFastFill,
                matchingEngineRouterEndpoint,
                matchingEngineCustodyToken,
                matchingEngineProgram,
            })
            .instruction();
    }

    async initializeIx(accounts: {
        owner: PublicKey;
        ownerAssistant: PublicKey;
        mint?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, ownerAssistant, mint: inputMint } = accounts;
        return this.program.methods
            .initialize()
            .accounts({
                owner,
                custodian: this.custodianAddress(),
                ownerAssistant,
                mint: inputMint ?? this.mint,
                custodyToken: this.custodyTokenAccountAddress(),
                programData: getProgramData(this.ID),
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

    matchingEngineProgram(): matchingEngineSdk.MatchingEngineProgram {
        switch (this._programId) {
            case testnet(): {
                return new matchingEngineSdk.MatchingEngineProgram(
                    this.program.provider.connection,
                    matchingEngineSdk.testnet(),
                    this.mint
                );
            }
            case localnet(): {
                return new matchingEngineSdk.MatchingEngineProgram(
                    this.program.provider.connection,
                    matchingEngineSdk.localnet(),
                    this.mint
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
}

export function localnet(): ProgramId {
    return "TokenRouter11111111111111111111111111111111";
}

export function testnet(): ProgramId {
    return "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md";
}
