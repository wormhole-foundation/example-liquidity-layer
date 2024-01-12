import { ethers } from "ethers";
import { Fill, LiquidityLayerDeposit } from "./deposit";

const ID_DEPOSIT = 1;
const ID_FAST_FILL = 12;
const ID_FAST_MARKET_ORDER = 13;
const ID_SLOW_ORDER_RESPONSE = 14;

export * from "./deposit";

export type FastFill = {
    fill: Fill;
    amount: bigint;
};

export type FastMarketOrder = {
    amountIn: bigint;
    minAmountOut: bigint;
    targetChain: number;
    destinationCctpDomain: number;
    redeemer: Buffer;
    sender: Buffer;
    refundAddress: Buffer;
    slowSequence: bigint;
    slowEmitter: Buffer;
    maxFee: bigint;
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;
};

export type SlowOrderResponse = {
    baseFee: bigint;
};

export class LiquidityLayerMessage {
    deposit?: LiquidityLayerDeposit;
    fastFill?: FastFill;
    fastMarketOrder?: FastMarketOrder;
    slowOrderResponse?: SlowOrderResponse;

    constructor(message: {
        deposit?: LiquidityLayerDeposit;
        fastFill?: FastFill;
        fastMarketOrder?: FastMarketOrder;
        slowOrderResponse?: SlowOrderResponse;
    }) {
        const { deposit, fastFill, fastMarketOrder, slowOrderResponse } = message;
        this.deposit = deposit;
        this.fastFill = fastFill;
        this.fastMarketOrder = fastMarketOrder;
        this.slowOrderResponse = slowOrderResponse;
    }

    static decode(buf: Buffer): LiquidityLayerMessage {
        const payloadId = buf.readUInt8(0);
        buf = buf.subarray(1);

        const message = (() => {
            switch (payloadId) {
                case ID_DEPOSIT: {
                    return {
                        deposit: LiquidityLayerDeposit.decode(buf),
                    };
                }
                case ID_FAST_FILL: {
                    const sourceChain = buf.readUInt16BE(0);
                    const orderSender = Array.from(buf.subarray(2, 34));
                    const redeemer = Array.from(buf.subarray(34, 66));
                    const redeemerMessageLen = buf.readUInt32BE(66);
                    const redeemerMessage = buf.subarray(70, 70 + redeemerMessageLen);
                    const amount = BigInt(
                        ethers.BigNumber.from(
                            buf.subarray(70 + redeemerMessageLen, 86 + redeemerMessageLen)
                        ).toString()
                    );
                    return {
                        fastFill: {
                            fill: { sourceChain, orderSender, redeemer, redeemerMessage },
                            amount,
                        },
                    };
                }
                case ID_FAST_MARKET_ORDER: {
                    // TODO: Implement
                    return {
                        fastMarketOrder: undefined,
                    };
                }
                case ID_SLOW_ORDER_RESPONSE: {
                    const baseFee = BigInt(ethers.BigNumber.from(buf).toString());
                    return {
                        slowOrderResponse: { baseFee },
                    };
                }
                default: {
                    throw new Error("Invalid Liquidity Layer deposit message");
                }
            }
        })();

        return new LiquidityLayerMessage(message);
    }

    encode(): Buffer {
        const { deposit, fastFill, fastMarketOrder, slowOrderResponse } = this;

        const buf = (() => {
            if (deposit !== undefined) {
                return deposit.encode();
            } else if (fastFill !== undefined) {
                const { fill, amount } = fastFill;
                const { sourceChain, orderSender, redeemer, redeemerMessage } = fill;

                const messageBuf = Buffer.alloc(86 + redeemerMessage.length);

                let offset = 0;
                offset = messageBuf.writeUInt16BE(sourceChain, offset);
                messageBuf.set(orderSender, offset);
                offset += 32;
                messageBuf.set(redeemer, offset);
                offset += 32;
                offset = messageBuf.writeUInt32BE(redeemerMessage.length, offset);
                messageBuf.set(redeemerMessage, 70);
                offset += redeemerMessage.length;
                offset = messageBuf.writeBigUInt64BE(amount, offset);

                return Buffer.concat([Buffer.alloc(1, ID_FAST_FILL), messageBuf]);
            } else if (fastMarketOrder !== undefined) {
                // TODO: Implement
                return Buffer.alloc(1, ID_FAST_MARKET_ORDER);
            } else if (slowOrderResponse !== undefined) {
                const { baseFee } = slowOrderResponse;

                const messageBuf = Buffer.alloc(8);
                messageBuf.writeBigUInt64BE(baseFee, 0);

                return Buffer.concat([Buffer.alloc(1, ID_SLOW_ORDER_RESPONSE), messageBuf]);
            } else {
                throw new Error("Invalid Liquidity Layer deposit message");
            }
        })();

        return buf;
    }
}
