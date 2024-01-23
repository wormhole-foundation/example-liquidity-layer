import {
    CHAIN_ID_ETH,
    ChainId,
    coalesceChainId,
    parseVaa,
    tryNativeToHexString,
} from "@certusone/wormhole-sdk";
import { MockEmitter, MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { postVaaSolana, solana as wormSolana } from "@certusone/wormhole-sdk";
import { WORMHOLE_CONTRACTS, USDC_MINT_ADDRESS, MAX_BPS_FEE } from "../../tests/helpers";
import { AuctionConfig } from "../../src/matchingEngine";
import { getPostedMessage } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { Fill, LiquidityLayerMessage, FastMarketOrder } from "../../src";

import { expect } from "chai";

export async function getTokenBalance(connection: Connection, address: PublicKey) {
    return (
        await getAccount(
            connection,
            await getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, address)
        )
    ).amount;
}

export async function postVaa(
    connection: Connection,
    payer: Keypair,
    vaaBuf: Buffer,
    coreBridgeAddress?: PublicKey
) {
    await postVaaSolana(
        connection,
        new wormSolana.NodeWallet(payer).signTransaction,
        coreBridgeAddress ?? WORMHOLE_CONTRACTS.solana.core,
        payer.publicKey,
        vaaBuf
    );
}

export function encodeFastMarketOrder(order: FastMarketOrder): Buffer {
    const encodedFastOrder = new LiquidityLayerMessage({ fastMarketOrder: order }).encode();
    return encodedFastOrder;
}

export function decodeFastMarketOrder(buf: Buffer): FastMarketOrder {
    const order = LiquidityLayerMessage.decode(buf);

    if (order.fastMarketOrder === undefined) {
        throw new Error("Invalid message type");
    }

    return order.fastMarketOrder;
}

export async function postVaaWithMessage(
    connection: Connection,
    payer: Keypair,
    guardians: MockGuardians,
    sequence: bigint,
    payload: Buffer,
    emitterAddress: string,
    emitterChain?: ChainId
): Promise<[PublicKey, Buffer]> {
    if (emitterChain === undefined) {
        emitterChain = CHAIN_ID_ETH;
    }

    console.log(payload.toString("hex"));
    const foreignEmitter = new MockEmitter(
        tryNativeToHexString(emitterAddress, emitterChain),
        emitterChain,
        Number(sequence)
    );

    const published = foreignEmitter.publishMessage(
        0, // nonce,
        payload,
        200, // consistencyLevel
        12345678 // timestamp
    );
    const vaaBuf = guardians.addSignatures(published, [0]);

    await postVaa(connection, payer, vaaBuf);

    return [derivePostedVaaKey(WORMHOLE_CONTRACTS.solana.core, parseVaa(vaaBuf).hash), vaaBuf];
}

export async function postFastTransferVaa(
    connection: Connection,
    payer: Keypair,
    guardians: MockGuardians,
    sequence: bigint,
    fastMessage: FastMarketOrder,
    emitterAddress: string,
    emitterChain?: ChainId
): Promise<[PublicKey, Buffer]> {
    return postVaaWithMessage(
        connection,
        payer,
        guardians,
        sequence,
        encodeFastMarketOrder(fastMessage),
        emitterAddress,
        emitterChain
    );
}

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export async function skip_slots(connection: Connection, slots: number): Promise<number> {
    const start = await connection.getSlot();

    while (true) {
        const lastSlot = await connection.getSlot();
        if (lastSlot >= start + slots) {
            return lastSlot + 1;
        }
        await sleep(500);
    }
}

export async function calculateDynamicPenalty(
    auctionConfig: AuctionConfig,
    amount: number,
    slotsElapsed: number
): Promise<[number, number]> {
    if (slotsElapsed <= auctionConfig.auctionGracePeriod) {
        return [0, 0];
    }

    const penaltyPeriod = slotsElapsed - auctionConfig.auctionGracePeriod;
    if (
        penaltyPeriod >= auctionConfig.auctionPenaltySlots ||
        auctionConfig.initialPenaltyBps == 0
    ) {
        const userReward = Math.floor((amount * auctionConfig.userPenaltyRewardBps) / MAX_BPS_FEE);
        return [amount - userReward, userReward];
    } else {
        const basePenalty = Math.floor(amount * auctionConfig.initialPenaltyBps) / MAX_BPS_FEE;
        const penalty = Math.floor(
            basePenalty +
                ((amount - basePenalty) * penaltyPeriod) / auctionConfig.auctionPenaltySlots
        );
        const userReward = Math.floor((penalty * auctionConfig.userPenaltyRewardBps) / MAX_BPS_FEE);

        return [penalty - userReward, userReward];
    }
}

export async function verifyFillMessage(
    connection: Connection,
    message: PublicKey,
    amount: bigint,
    targetDomain: number,
    expectedFill: Fill
) {
    const fillPayload = (await getPostedMessage(connection, message)).message.payload;
    const parsed = LiquidityLayerMessage.decode(fillPayload);

    expect(parsed.deposit?.header.amount).to.equal(amount);
    expect(parsed.deposit?.header.destinationCctpDomain).to.equal(targetDomain);
    expect(parsed.deposit?.message.fill).to.deep.equal(expectedFill);
}

export async function verifyFastFillMessage(
    connection: Connection,
    message: PublicKey,
    amount: bigint,
    expectedFill: Fill
) {
    const fillPayload = (await getPostedMessage(connection, message)).message.payload;
    const parsed = LiquidityLayerMessage.decode(fillPayload);

    expect(parsed.fastFill?.fill).to.deep.equal(expectedFill);
    expect(parsed.fastFill?.amount).to.equal(amount);
}
