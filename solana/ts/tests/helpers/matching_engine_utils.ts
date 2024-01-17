import { coalesceChainId, parseVaa, tryNativeToHexString } from "@certusone/wormhole-sdk";
import { MockEmitter, MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { postVaaSolana, solana as wormSolana } from "@certusone/wormhole-sdk";
import { WORMHOLE_CONTRACTS, USDC_MINT_ADDRESS } from "../../tests/helpers";
import { MatchingEngineProgram } from "../../src/matchingEngine";
import { ethers } from "ethers";

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

export interface FastMarketOrder {
    amountIn: bigint;
    minAmountOut: bigint;
    targetChain: number;
    targetDomain: number;
    redeemer: Buffer;
    sender: Buffer;
    refundAddress: Buffer;
    slowSequence: bigint;
    slowEmitter: Buffer;
    maxFee: bigint;
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;
}

export function encodeFastMarketOrder(order: FastMarketOrder): Buffer {
    const buf = Buffer.alloc(214);

    let offset = 0;

    const amountIn = ethers.utils.arrayify(ethers.BigNumber.from(order.amountIn).toHexString());
    buf.set(amountIn, (offset += 16) - amountIn.length);

    const minAmountOut = ethers.utils.arrayify(
        ethers.BigNumber.from(order.minAmountOut).toHexString()
    );
    buf.set(minAmountOut, (offset += 16) - minAmountOut.length);

    offset = buf.writeUInt16BE(order.targetChain, offset);
    offset = buf.writeUInt32BE(order.targetDomain, offset);

    buf.set(order.redeemer, offset);
    offset += 32;

    buf.set(order.sender, offset);
    offset += 32;

    buf.set(order.refundAddress, offset);
    offset += 32;

    offset = buf.writeBigUInt64BE(order.slowSequence, offset);

    buf.set(order.slowEmitter, offset);
    offset += 32;

    const maxFee = ethers.utils.arrayify(ethers.BigNumber.from(order.maxFee).toHexString());
    buf.set(maxFee, (offset += 16) - maxFee.length);

    const initAuctionfee = ethers.utils.arrayify(
        ethers.BigNumber.from(order.initAuctionFee).toHexString()
    );
    buf.set(initAuctionfee, (offset += 16) - initAuctionfee.length);

    offset = buf.writeUInt32BE(order.deadline, offset);
    offset = buf.writeUInt32BE(order.redeemerMessage.length, offset);

    return Buffer.concat([Buffer.alloc(1, 13), buf, order.redeemerMessage]);
}

function takePayloadId(buf: Buffer, expectedId: number): Buffer {
    if (buf.readUInt8(0) != expectedId) {
        throw new Error("Invalid payload ID");
    }

    return buf.subarray(1);
}

export function decodeFastMarketOrder(buf: Buffer): FastMarketOrder {
    let order = {} as FastMarketOrder;

    buf = takePayloadId(buf, 13);

    order.amountIn = BigInt(ethers.BigNumber.from(buf.subarray(0, 16)).toString());
    order.minAmountOut = BigInt(ethers.BigNumber.from(buf.subarray(16, 32)).toString());
    order.targetChain = buf.readUInt16BE(32);
    order.targetDomain = buf.readUInt32BE(34);
    order.redeemer = buf.subarray(38, 70);
    order.sender = buf.subarray(70, 102);
    order.refundAddress = buf.subarray(102, 134);
    order.slowSequence = buf.readBigUint64BE(134);
    order.slowEmitter = buf.subarray(142, 174);
    order.maxFee = BigInt(ethers.BigNumber.from(buf.subarray(174, 190)).toString());
    order.initAuctionFee = BigInt(ethers.BigNumber.from(buf.subarray(190, 206)).toString());
    order.deadline = buf.readUInt32BE(206);

    const redeemerMsgLen = buf.readUInt32BE(210);
    order.redeemerMessage = buf.subarray(214, 214 + redeemerMsgLen);

    return order;
}

export async function postFastTransferVaa(
    connection: Connection,
    payer: Keypair,
    guardians: MockGuardians,
    sequence: bigint,
    fastMessage: FastMarketOrder,
    emitterAddress: string
): Promise<[PublicKey, Buffer]> {
    const chainName = "ethereum";
    const foreignEmitter = new MockEmitter(
        tryNativeToHexString(emitterAddress, chainName),
        coalesceChainId(chainName),
        Number(sequence)
    );

    const published = foreignEmitter.publishMessage(
        0, // nonce,
        encodeFastMarketOrder(fastMessage),
        200, // consistencyLevel
        12345678 // timestamp
    );
    const vaaBuf = guardians.addSignatures(published, [0]);

    await postVaa(connection, payer, vaaBuf);

    return [derivePostedVaaKey(WORMHOLE_CONTRACTS.solana.core, parseVaa(vaaBuf).hash), vaaBuf];
}

export async function getBestOfferTokenAccount(
    engine: MatchingEngineProgram,
    vaaHash: Buffer
): Promise<PublicKey> {
    return (await engine.fetchAuctionData(vaaHash)).bestOfferToken;
}

export async function getInitialOfferTokenAccount(
    engine: MatchingEngineProgram,
    vaaHash: Buffer
): Promise<PublicKey> {
    return (await engine.fetchAuctionData(vaaHash)).initialOfferToken;
}

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export async function skip_slots(connection: Connection, slots: number) {
    const start = await connection.getSlot();
    while ((await connection.getSlot()) < start + slots) {
        await sleep(500);
    }
}
