import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { ChainId } from "@wormhole-foundation/sdk-base";
import { VaaHash } from "../common";
import { FastFillInfo, FastFillSeeds, MessageProtocol, ProposalAction } from "./state";

export type AddCctpRouterEndpointArgs = {
    chain: ChainId;
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
    fromRouterEndpoint: PublicKey;
    toRouterEndpoint: PublicKey;
    localCustodyToken: PublicKey;
    matchingEngineProgram: PublicKey;
};

export type CctpMessageArgs = {
    encodedCctpMessage: Buffer;
    cctpAttestation: Buffer;
};

export type SettledTokenAccountInfo = {
    key: PublicKey;
    balanceAfter: BN;
};

export type AuctionSettled = {
    auction: PublicKey;
    bestOfferToken: SettledTokenAccountInfo | null;
    executorToken: SettledTokenAccountInfo | null;
    withExecute: MessageProtocol | null;
};

export type AuctionUpdated = {
    configId: number;
    auction: PublicKey;
    vaa: PublicKey | null;
    sourceChain: number;
    targetProtocol: MessageProtocol;
    redeemerMessageLen: number;
    endSlot: BN;
    bestOfferToken: PublicKey;
    tokenBalanceBefore: BN;
    amountIn: BN;
    totalDeposit: BN;
    maxOfferPriceAllowed: BN | null;
};

export type OrderExecuted = {
    auction: PublicKey;
    vaa: PublicKey;
    targetProtocol: MessageProtocol;
};

export type Proposed = {
    action: ProposalAction;
};

export type Enacted = {
    action: ProposalAction;
};

export type LocalFastOrderFilled = {
    seeds: FastFillSeeds;
    info: FastFillInfo;
    auction: PublicKey | null;
};

export type FastFillSequenceReserved = {
    fastVaaHash: Array<number>;
    fastFillSeeds: FastFillSeeds;
};

export type FastFillRedeemed = {
    preparedBy: PublicKey;
    fastFill: PublicKey;
};

export type FastOrderPathComposite = {
    fastVaa: {
        vaa: PublicKey;
    };
    path: {
        fromEndpoint: {
            endpoint: PublicKey;
        };
        toEndpoint: { endpoint: PublicKey };
    };
};

export type ReserveFastFillSequenceCompositeOpts = {
    fastVaaHash?: VaaHash;
    sourceChain?: ChainId;
    orderSender?: Array<number>;
    targetChain?: ChainId;
};
