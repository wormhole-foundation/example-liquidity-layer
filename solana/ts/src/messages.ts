import { ethers } from "ethers";

export type DepositHeader = {
    tokenAddress: Array<number>;
    amount: bigint;
    sourceCctpDomain: number;
    destinationCctpDomain: number;
    cctpNonce: bigint;
    burnSource: Array<number>;
    mintRecipient: Array<number>;
};

export type Fill = {
    sourceChain: number;
    orderSender: Array<number>;
    redeemer: Array<number>;
    redeemerMessage: Buffer;
};

export type FastFill = {
    fill: Fill;
    amount: bigint;
};

export type SlowOrderResponse = {
    baseFee: bigint;
};

export type DepositMessage = {
    fill?: Fill;
    fastFill?: FastFill;
    slowOrderResponse?: SlowOrderResponse;
};

export class LiquidityLayerDeposit {
    deposit: DepositHeader;
    message: DepositMessage;

    constructor(deposit: DepositHeader, message: DepositMessage) {
        this.deposit = deposit;
        this.message = message;
    }

    static decode(buf: Buffer): LiquidityLayerDeposit {
        if (buf.readUInt8(0) != 1) {
            throw new Error("Invalid Wormhole CCTP deposit message");
        }
        buf = buf.subarray(1);

        const tokenAddress = Array.from(buf.subarray(0, 32));
        const amount = BigInt(ethers.BigNumber.from(buf.subarray(32, 64)).toString());
        const sourceCctpDomain = buf.readUInt32BE(64);
        const destinationCctpDomain = buf.readUInt32BE(68);
        const cctpNonce = buf.readBigUint64BE(72);
        const burnSource = Array.from(buf.subarray(80, 112));
        const mintRecipient = Array.from(buf.subarray(112, 144));
        const payloadLen = buf.readUInt16BE(144);
        const payload = buf.subarray(146, 146 + payloadLen);

        const payloadId = payload.readUInt8(0);
        const messageBuf = payload.subarray(1);

        const message = (() => {
            switch (payloadId) {
                case 11: {
                    const sourceChain = messageBuf.readUInt16BE(0);
                    const orderSender = Array.from(messageBuf.subarray(2, 34));
                    const redeemer = Array.from(messageBuf.subarray(34, 66));
                    const redeemerMessageLen = messageBuf.readUInt32BE(66);
                    const redeemerMessage = messageBuf.subarray(70, 70 + redeemerMessageLen);
                    return {
                        fill: { sourceChain, orderSender, redeemer, redeemerMessage },
                    };
                }
                case 12: {
                    const sourceChain = messageBuf.readUInt16BE(0);
                    const orderSender = Array.from(messageBuf.subarray(2, 34));
                    const redeemer = Array.from(messageBuf.subarray(34, 66));
                    const redeemerMessageLen = messageBuf.readUInt32BE(66);
                    const redeemerMessage = messageBuf.subarray(70, 70 + redeemerMessageLen);
                    const amount = BigInt(
                        ethers.BigNumber.from(
                            messageBuf.subarray(70 + redeemerMessageLen, 86 + redeemerMessageLen)
                        ).toString()
                    );
                    return {
                        fastFill: {
                            fill: { sourceChain, orderSender, redeemer, redeemerMessage },
                            amount,
                        },
                    };
                }
                case 14: {
                    const baseFee = BigInt(ethers.BigNumber.from(messageBuf).toString());
                    return { slowOrderResponse: { baseFee } };
                }
                default: {
                    throw new Error("Invalid Liquidity Layer deposit message");
                }
            }
        })();

        return new LiquidityLayerDeposit(
            {
                tokenAddress,
                amount,
                sourceCctpDomain,
                destinationCctpDomain,
                cctpNonce,
                burnSource,
                mintRecipient,
            },
            message
        );
    }

    encode(): Buffer {
        const buf = Buffer.alloc(146);

        const { deposit, message } = this;
        const {
            tokenAddress,
            amount,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
        } = deposit;

        let offset = 0;
        buf.set(tokenAddress, offset);
        offset += 32;

        // Special handling w/ uint256. This value will most likely encoded in < 32 bytes, so we
        // jump ahead by 32 and subtract the length of the encoded value.
        const encodedAmount = ethers.utils.arrayify(ethers.BigNumber.from(amount.toString()));
        buf.set(encodedAmount, (offset += 32) - encodedAmount.length);

        offset = buf.writeUInt32BE(sourceCctpDomain, offset);
        offset = buf.writeUInt32BE(destinationCctpDomain, offset);
        offset = buf.writeBigUInt64BE(cctpNonce, offset);
        buf.set(burnSource, offset);
        offset += 32;
        buf.set(mintRecipient, offset);
        offset += 32;

        const { fill, fastFill, slowOrderResponse } = message;
        const payload = (() => {
            if (fill !== undefined) {
                const { sourceChain, orderSender, redeemer, redeemerMessage } = fill;

                const messageBuf = Buffer.alloc(70 + redeemerMessage.length);

                let offset = 0;
                offset = messageBuf.writeUInt16BE(sourceChain, offset);
                messageBuf.set(orderSender, offset);
                offset += 32;
                messageBuf.set(redeemer, offset);
                offset += 32;
                offset = messageBuf.writeUInt32BE(redeemerMessage.length, offset);
                messageBuf.set(redeemerMessage, 70);
                offset += redeemerMessage.length;

                return Buffer.concat([Buffer.alloc(1, 11), messageBuf]);
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

                return Buffer.concat([Buffer.alloc(1, 12), messageBuf]);
            } else if (slowOrderResponse !== undefined) {
                const { baseFee } = slowOrderResponse;

                const messageBuf = Buffer.alloc(8);
                messageBuf.writeBigUInt64BE(baseFee, 0);

                return Buffer.concat([Buffer.alloc(1, 14), messageBuf]);
            } else {
                throw new Error("Invalid Liquidity Layer deposit message");
            }
        })();

        // Finally write the length.
        buf.writeUInt16BE(payload.length, offset);

        return Buffer.concat([Buffer.alloc(1, 1), buf, payload]);
    }
}
