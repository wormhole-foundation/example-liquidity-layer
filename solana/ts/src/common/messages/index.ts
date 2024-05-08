import * as wormholeSdk from "@certusone/wormhole-sdk";
import { ID_DEPOSIT, LiquidityLayerDeposit } from "./deposit";

export * from "./deposit";

export const ID_FAST_MARKET_ORDER = 11;

export type FastMarketOrder = {
    // u64
    amountIn: bigint;
    // u64
    minAmountOut: bigint;
    targetChain: wormholeSdk.ChainId;
    redeemer: Array<number>;
    sender: Array<number>;
    refundAddress: Array<number>;
    // u64
    maxFee: bigint;
    // u64
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;
};

export class LiquidityLayerMessage {
    deposit?: LiquidityLayerDeposit;
    fastMarketOrder?: FastMarketOrder;

    constructor(message: { deposit?: LiquidityLayerDeposit; fastMarketOrder?: FastMarketOrder }) {
        const { deposit, fastMarketOrder } = message;
        this.deposit = deposit;
        this.fastMarketOrder = fastMarketOrder;
    }

    static decode(buf: Buffer): LiquidityLayerMessage {
        let offset = 0;
        const payloadId = buf.readUInt8(offset);
        offset += 1;

        let deposit: LiquidityLayerDeposit | undefined;
        let fastMarketOrder: FastMarketOrder | undefined;

        switch (payloadId) {
            case ID_DEPOSIT: {
                deposit = LiquidityLayerDeposit.decode(buf);
                break;
            }
            case ID_FAST_MARKET_ORDER: {
                const amountIn = buf.readBigUInt64BE(offset);
                offset += 8;
                const minAmountOut = buf.readBigUInt64BE(offset);
                offset += 8;
                const targetChain = buf.readUInt16BE(offset);
                if (!wormholeSdk.isChain(targetChain)) {
                    throw new Error("Invalid target chain");
                }
                offset += 2;
                const redeemer = Array.from(buf.subarray(offset, (offset += 32)));
                const sender = Array.from(buf.subarray(offset, (offset += 32)));
                const refundAddress = Array.from(buf.subarray(offset, (offset += 32)));
                const maxFee = buf.readBigUInt64BE(offset);
                offset += 8;
                const initAuctionFee = buf.readBigUInt64BE(offset);
                offset += 8;
                const deadline = buf.readUInt32BE(offset);
                offset += 4;
                const redeemerMessageLen = buf.readUInt32BE(offset);
                offset += 4;
                const redeemerMessage = buf.subarray(offset, (offset += redeemerMessageLen));

                fastMarketOrder = {
                    amountIn,
                    minAmountOut,
                    targetChain,
                    redeemer,
                    sender,
                    refundAddress,
                    maxFee,
                    initAuctionFee,
                    deadline,
                    redeemerMessage,
                };
                break;
            }
            default: {
                throw new Error("Invalid Liquidity Layer message");
            }
        }

        return new LiquidityLayerMessage({ deposit, fastMarketOrder });
    }

    encode(): Buffer {
        const { deposit, fastMarketOrder } = this;

        const buf = (() => {
            if (deposit !== undefined) {
                return deposit.encode();
            } else if (fastMarketOrder !== undefined) {
                const {
                    amountIn,
                    minAmountOut,
                    targetChain,
                    redeemer,
                    sender,
                    refundAddress,
                    maxFee,
                    initAuctionFee,
                    deadline,
                    redeemerMessage,
                } = fastMarketOrder;

                const messageBuf = Buffer.alloc(1 + 138 + redeemerMessage.length);

                let offset = 0;
                offset = messageBuf.writeUInt8(ID_FAST_MARKET_ORDER, offset);
                offset = messageBuf.writeBigUInt64BE(amountIn, offset);
                offset = messageBuf.writeBigUInt64BE(minAmountOut, offset);
                offset = messageBuf.writeUInt16BE(targetChain, offset);
                messageBuf.set(redeemer, offset);
                offset += redeemer.length;
                messageBuf.set(sender, offset);
                offset += sender.length;
                messageBuf.set(refundAddress, offset);
                offset += refundAddress.length;
                offset = messageBuf.writeBigUInt64BE(maxFee, offset);
                offset = messageBuf.writeBigUInt64BE(initAuctionFee, offset);
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
