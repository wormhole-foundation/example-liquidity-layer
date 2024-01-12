import { BN } from "@coral-xyz/anchor";
import { ethers } from "ethers";
import { Fill, ID_DEPOSIT, LiquidityLayerDeposit } from "./deposit";

export * from "./deposit";

export const ID_FAST_FILL = 12;
export const ID_FAST_MARKET_ORDER = 13;

export type FastFill = {
    fill: Fill;
    // u128
    amount: bigint;
};

export type FastMarketOrder = {
    // u128
    amountIn: bigint;
    // u128
    minAmountOut: bigint;
    targetChain: number;
    destinationCctpDomain: number;
    redeemer: Array<number>;
    sender: Array<number>;
    refundAddress: Array<number>;
    slowSequence: bigint;
    slowEmitter: Array<number>;
    // u128
    maxFee: bigint;
    // u128
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;
};

export class LiquidityLayerMessage {
    deposit?: LiquidityLayerDeposit;
    fastFill?: FastFill;
    fastMarketOrder?: FastMarketOrder;

    constructor(message: {
        deposit?: LiquidityLayerDeposit;
        fastFill?: FastFill;
        fastMarketOrder?: FastMarketOrder;
    }) {
        const { deposit, fastFill, fastMarketOrder } = message;
        this.deposit = deposit;
        this.fastFill = fastFill;
        this.fastMarketOrder = fastMarketOrder;
    }

    static decode(buf: Buffer): LiquidityLayerMessage {
        let offset = 0;
        const payloadId = buf.readUInt8(offset);
        offset += 1;

        const { deposit, fastFill, fastMarketOrder } = (() => {
            switch (payloadId) {
                case ID_DEPOSIT: {
                    return {
                        deposit: LiquidityLayerDeposit.decode(buf),
                        fastFill: undefined,
                        fastMarketOrder: undefined,
                    };
                }
                case ID_FAST_FILL: {
                    const sourceChain = buf.readUInt16BE(offset);
                    offset += 2;
                    const orderSender = Array.from(buf.subarray(offset, (offset += 32)));
                    const redeemer = Array.from(buf.subarray(offset, (offset += 32)));
                    const redeemerMessageLen = buf.readUInt32BE(offset);
                    offset += 4;
                    const redeemerMessage = buf.subarray(offset, (offset += redeemerMessageLen));
                    const amount = BigInt(
                        new BN(buf.subarray(offset, (offset += 16)), undefined, "be").toString()
                    );
                    return {
                        deposit: undefined,
                        fastFill: {
                            fill: { sourceChain, orderSender, redeemer, redeemerMessage },
                            amount,
                        } as FastFill,
                        fastMarketOrder: undefined,
                    };
                }
                case ID_FAST_MARKET_ORDER: {
                    const amountIn = BigInt(
                        new BN(buf.subarray(offset, (offset += 16)), undefined, "be").toString()
                    );
                    const minAmountOut = BigInt(
                        new BN(buf.subarray(offset, (offset += 16)), undefined, "be").toString()
                    );
                    const targetChain = buf.readUInt16BE(offset);
                    offset += 2;
                    const destinationCctpDomain = buf.readUInt32BE(offset);
                    offset += 4;
                    const redeemer = Array.from(buf.subarray(offset, (offset += 32)));
                    const sender = Array.from(buf.subarray(offset, (offset += 32)));
                    const refundAddress = Array.from(buf.subarray(offset, (offset += 32)));
                    const slowSequence = buf.readBigUInt64BE(offset);
                    offset += 8;
                    const slowEmitter = Array.from(buf.subarray(offset, (offset += 32)));
                    const maxFee = BigInt(
                        new BN(buf.subarray(offset, (offset += 16)), undefined, "be").toString()
                    );
                    const initAuctionFee = BigInt(
                        new BN(buf.subarray(offset, (offset += 16)), undefined, "be").toString()
                    );
                    const deadline = buf.readUInt32BE(offset);
                    offset += 4;
                    const redeemerMessageLen = buf.readUInt32BE(offset);
                    offset += 4;
                    const redeemerMessage = buf.subarray(offset, (offset += redeemerMessageLen));
                    return {
                        deposit: undefined,
                        fastFill: undefined,
                        fastMarketOrder: {
                            amountIn,
                            minAmountOut,
                            targetChain,
                            destinationCctpDomain,
                            redeemer,
                            sender,
                            refundAddress,
                            slowSequence,
                            slowEmitter,
                            maxFee,
                            initAuctionFee,
                            deadline,
                            redeemerMessage,
                        } as FastMarketOrder,
                    };
                }
                default: {
                    throw new Error("Invalid Liquidity Layer message");
                }
            }
        })();

        return new LiquidityLayerMessage({ deposit, fastFill, fastMarketOrder });
    }

    encode(): Buffer {
        const { deposit, fastFill, fastMarketOrder } = this;

        const buf = (() => {
            if (deposit !== undefined) {
                return deposit.encode();
            } else if (fastFill !== undefined) {
                const { fill, amount } = fastFill;
                const { sourceChain, orderSender, redeemer, redeemerMessage } = fill;

                const messageBuf = Buffer.alloc(1 + 86 + redeemerMessage.length);

                let offset = 0;
                offset = messageBuf.writeUInt8(ID_FAST_FILL, offset);
                offset = messageBuf.writeUInt16BE(sourceChain, offset);
                messageBuf.set(orderSender, offset);
                offset += orderSender.length;
                messageBuf.set(redeemer, offset);
                offset += redeemer.length;
                offset = messageBuf.writeUInt32BE(redeemerMessage.length, offset);
                messageBuf.set(redeemerMessage, offset);
                offset += redeemerMessage.length;
                const encodedAmount = new BN(amount.toString()).toBuffer("be", 16);
                messageBuf.set(encodedAmount, offset);
                offset += encodedAmount.length;

                return messageBuf;
            } else if (fastMarketOrder !== undefined) {
                const {
                    amountIn,
                    minAmountOut,
                    targetChain,
                    destinationCctpDomain,
                    redeemer,
                    sender,
                    refundAddress,
                    slowSequence,
                    slowEmitter,
                    maxFee,
                    initAuctionFee,
                    deadline,
                    redeemerMessage,
                } = fastMarketOrder;

                const messageBuf = Buffer.alloc(1 + 214 + redeemerMessage.length);

                let offset = 0;
                offset = messageBuf.writeUInt8(ID_FAST_MARKET_ORDER, offset);
                const encodedAmountIn = new BN(amountIn.toString()).toBuffer("be", 16);
                messageBuf.set(encodedAmountIn, offset);
                offset += encodedAmountIn.length;
                const encodedMinAmountOut = new BN(minAmountOut.toString()).toBuffer("be", 16);
                messageBuf.set(encodedMinAmountOut, offset);
                offset += encodedMinAmountOut.length;
                offset = messageBuf.writeUInt16BE(targetChain, offset);
                offset = messageBuf.writeUInt32BE(destinationCctpDomain, offset);
                messageBuf.set(redeemer, offset);
                offset += redeemer.length;
                messageBuf.set(sender, offset);
                offset += sender.length;
                messageBuf.set(refundAddress, offset);
                offset += refundAddress.length;
                offset = messageBuf.writeBigUInt64BE(slowSequence, offset);
                messageBuf.set(slowEmitter, offset);
                offset += slowEmitter.length;
                const encodedMaxFee = new BN(maxFee.toString()).toBuffer("be", 16);
                messageBuf.set(encodedMaxFee, offset);
                offset += encodedMaxFee.length;
                const encodedInitAuctionFee = new BN(initAuctionFee.toString()).toBuffer("be", 16);
                messageBuf.set(encodedInitAuctionFee, offset);
                offset += encodedInitAuctionFee.length;
                offset = messageBuf.writeUInt32BE(deadline, offset);
                offset = messageBuf.writeUInt32BE(redeemerMessage.length, offset);
                messageBuf.set(redeemerMessage, offset);
                offset += redeemerMessage.length;

                return messageBuf;
            } else {
                throw new Error("Invalid Liquidity Layer message");
            }
        })();

        return buf;
    }
}
