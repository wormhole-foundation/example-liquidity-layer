import { PublicKey } from "@solana/web3.js";
import { ChainId } from "@wormhole-foundation/sdk-base";

export type PrepareMarketOrderArgs = {
    amountIn: bigint;
    minAmountOut: bigint | null;
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
    matchingEngineProgram: PublicKey;
    matchingEngineCustodian: PublicKey;
    matchingEngineCctpMintRecipient: PublicKey;
};

export type RedeemFillCctpAccounts = {
    custodian: PublicKey;
    preparedFill: PublicKey;
    cctpMintRecipient: PublicKey;
    sourceRouterEndpoint: PublicKey;
    messageTransmitterAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    usedNonces: PublicKey;
    messageTransmitterEventAuthority: PublicKey;
    tokenMessenger: PublicKey;
    remoteTokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    localToken: PublicKey;
    tokenPair: PublicKey;
    tokenMessengerMinterCustodyToken: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenMessengerMinterEventAuthority: PublicKey;
};

export type RedeemFastFillAccounts = {
    custodian: PublicKey;
    preparedFill: PublicKey;
    cctpMintRecipient: PublicKey;
    matchingEngineCustodian: PublicKey;
    matchingEngineFromEndpoint: PublicKey;
    matchingEngineToEndpoint: PublicKey;
    matchingEngineLocalCustodyToken: PublicKey;
    matchingEngineProgram: PublicKey;
};

export type AddCctpRouterEndpointArgs = {
    chain: number;
    cctpDomain: number;
    address: Array<number>;
    mintRecipient: Array<number> | null;
};
