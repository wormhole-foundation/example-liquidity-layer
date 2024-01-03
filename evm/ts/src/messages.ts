import { parseVaa as _parseVaa } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export const CCTP_DEPOSIT_PAYLOAD = 1;

export class WormholeCctpDepositHeader {
    token: Uint8Array;
    amount: bigint;
    sourceDomain: number;
    targetDomain: number;
    nonce: bigint;
    fromAddress: Uint8Array;
    mintRecipient: Uint8Array;

    constructor(
        token: Uint8Array,
        amount: bigint,
        sourceDomain: number,
        targetDomain: number,
        nonce: bigint,
        fromAddress: Uint8Array,
        mintRecipient: Uint8Array
    ) {
        this.token = token;
        this.amount = amount;
        this.sourceDomain = sourceDomain;
        this.targetDomain = targetDomain;
        this.nonce = nonce;
        this.fromAddress = fromAddress;
        this.mintRecipient = mintRecipient;
    }

    static decodeCoreBridgeMessage(buf: Buffer): [WormholeCctpDepositHeader, Buffer] {
        if (buf.readUInt8(0) != 1) {
            throw new Error("Invalid Wormhole CCTP deposit message");
        }

        return WormholeCctpDepositHeader.decode(buf.subarray(1));
    }

    static decode(buf: Buffer): [WormholeCctpDepositHeader, Buffer] {
        const token = Uint8Array.from(buf.subarray(0, 32));
        const amount = BigInt(ethers.BigNumber.from(buf.subarray(32, 64)).toString());
        const sourceDomain = buf.readUInt32BE(64);
        const targetDomain = buf.readUInt32BE(68);
        const nonce = buf.readBigUint64BE(72);
        const fromAddress = Uint8Array.from(buf.subarray(80, 112));
        const mintRecipient = Uint8Array.from(buf.subarray(112, 144));
        const payloadLen = buf.readUInt16BE(144);
        const payload = buf.subarray(146, 146 + payloadLen);

        return [
            new WormholeCctpDepositHeader(
                token,
                amount,
                sourceDomain,
                targetDomain,
                nonce,
                fromAddress,
                mintRecipient
            ),
            payload,
        ];
    }
}

export type LiquidityLayerMessageBody = {
    fill?: Fill;
    fastFill?: FastFill;
    slowOrderResponse?: SlowOrderResponse;
    fastMarketOrder?: FastMarketOrder;
};

export type CoreBridgeLiquidityLayerMessage = {
    header: {
        wormholeCctp?: WormholeCctpDepositHeader;
    };
    body: LiquidityLayerMessageBody;
};

export class MessageDecoder {
    wormholeCctpAddress?: Buffer | Uint8Array;

    constructor(wormholeCctpAddress?: Buffer | Uint8Array) {
        this.wormholeCctpAddress = wormholeCctpAddress;
    }

    static decode(payload: Buffer): LiquidityLayerMessageBody {
        const payloadId = payload.readUInt8(0);
        switch (payloadId) {
            case Fill.ID: {
                return { fill: Fill.decode(payload) };
            }
            case FastMarketOrder.ID: {
                return { fastMarketOrder: FastMarketOrder.decode(payload) };
            }
            case SlowOrderResponse.ID: {
                return { slowOrderResponse: SlowOrderResponse.decode(payload) };
            }
            case FastFill.ID: {
                return { fastFill: FastFill.decode(payload) };
            }
            default: {
                throw new Error(`Invalid payload ID: ${payloadId}`);
            }
        }
    }

    decodeCoreBridgeMessage(
        emitterAddress: Buffer | Uint8Array,
        messagePayload: Buffer | Uint8Array
    ) {
        const emitter = Buffer.from(emitterAddress);
        const payload = Buffer.from(messagePayload);
        if (this.wormholeCctpAddress !== undefined && emitter.equals(this.wormholeCctpAddress)) {
            return MessageDecoder.unsafeDecodeWormholeCctpPayload(payload);
        } else {
            throw new Error("unrecognized emitter");
        }
    }

    parseVaa(encodedVaa: Buffer) {
        const vaa = _parseVaa(encodedVaa);

        return {
            vaa,
            decoded: this.decodeCoreBridgeMessage(vaa.emitterAddress, vaa.payload),
        };
    }

    static unsafeDecodeWormholeCctpPayload(
        wormholeCctpMessage: Buffer
    ): CoreBridgeLiquidityLayerMessage {
        const [wormholeCctp, payload] =
            WormholeCctpDepositHeader.decodeCoreBridgeMessage(wormholeCctpMessage);
        return {
            header: { wormholeCctp },
            body: this.decode(payload),
        };
    }

    static unsafeDecodeFastPayload(vaa: Buffer): CoreBridgeLiquidityLayerMessage {
        const payload = Buffer.from(vaa);
        return {
            header: {},
            body: this.decode(payload),
        };
    }
}

export class Fill {
    sourceChain: number;
    orderSender: Buffer;
    redeemer: Buffer;
    redeemerMessage: Buffer;

    constructor(
        sourceChain: number,
        orderSender: Buffer,
        redeemer: Buffer,
        redeemerMessage: Buffer
    ) {
        this.sourceChain = sourceChain;
        this.orderSender = orderSender;
        this.redeemer = redeemer;
        this.redeemerMessage = redeemerMessage;
    }

    static get ID(): number {
        return 11;
    }

    static decode(payload: Buffer): Fill {
        const buf = takePayloadId(payload, this.ID);

        const sourceChain = buf.readUInt16BE(0);
        const orderSender = buf.subarray(2, 34);
        const redeemer = buf.subarray(34, 66);
        const redeemerMsgLen = buf.readUInt32BE(66);
        const redeemerMessage = buf.subarray(70, 70 + redeemerMsgLen);

        return new Fill(sourceChain, orderSender, redeemer, redeemerMessage);
    }
}

export class FastFill {
    sourceChain: number;
    orderSender: Buffer;
    redeemer: Buffer;
    redeemerMessage: Buffer;
    fillAmount: bigint;

    constructor(
        sourceChain: number,
        orderSender: Buffer,
        redeemer: Buffer,
        redeemerMessage: Buffer,
        fillAmount: bigint
    ) {
        this.sourceChain = sourceChain;
        this.orderSender = orderSender;
        this.redeemer = redeemer;
        this.redeemerMessage = redeemerMessage;
        this.fillAmount = fillAmount;
    }

    static get ID(): number {
        return 12;
    }

    static decode(payload: Buffer): FastFill {
        const buf = takePayloadId(payload, this.ID);

        const sourceChain = buf.readUInt16BE(0);
        const orderSender = buf.subarray(2, 34);
        const redeemer = buf.subarray(34, 66);
        const redeemerMsgLen = buf.readUInt32BE(66);
        const endMessage = 70 + redeemerMsgLen;
        const redeemerMessage = buf.subarray(70, endMessage);
        const fillAmount = BigInt(
            ethers.BigNumber.from(buf.subarray(endMessage, endMessage + 16)).toString()
        );

        return new FastFill(sourceChain, orderSender, redeemer, redeemerMessage, fillAmount);
    }
}

export class FastMarketOrder {
    amountIn: bigint;
    minAmountOut: bigint;
    targetChain: number;
    targetDomain: number;
    redeemer: Buffer;
    sender: Buffer;
    refundAddress: Buffer;
    slowSequence: number;
    slowEmitter: Buffer;
    maxFee: bigint;
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;

    constructor(
        amountIn: bigint,
        minAmountOut: bigint,
        targetChain: number,
        targetDomain: number,
        redeemer: Buffer,
        sender: Buffer,
        refundAddress: Buffer,
        slowSequence: number,
        slowEmitter: Buffer,
        maxFee: bigint,
        initAuctionFee: bigint,
        deadline: number,
        redeemerMessage: Buffer
    ) {
        this.amountIn = amountIn;
        this.minAmountOut = minAmountOut;
        this.targetChain = targetChain;
        this.targetDomain = targetDomain;
        this.redeemer = redeemer;
        this.sender = sender;
        this.refundAddress = refundAddress;
        this.slowSequence = slowSequence;
        this.slowEmitter = slowEmitter;
        this.maxFee = maxFee;
        this.initAuctionFee = initAuctionFee;
        this.deadline = deadline;
        this.redeemerMessage = redeemerMessage;
    }

    static get ID(): number {
        return 13;
    }

    static decode(payload: Buffer): FastMarketOrder {
        const buf = takePayloadId(payload, this.ID);

        const amountIn = BigInt(ethers.BigNumber.from(buf.subarray(0, 16)).toString());
        const minAmountOut = BigInt(ethers.BigNumber.from(buf.subarray(16, 32)).toString());
        const targetChain = buf.readUInt16BE(32);
        const targetDomain = buf.readUInt32BE(34);
        const redeemer = buf.subarray(38, 70);
        const sender = buf.subarray(70, 102);
        const refundAddress = buf.subarray(102, 134);
        const slowSequence = buf.readBigUint64BE(134);
        const slowEmitter = buf.subarray(142, 174);
        const maxFee = BigInt(ethers.BigNumber.from(buf.subarray(174, 190)).toString());
        const initAuctionFee = BigInt(ethers.BigNumber.from(buf.subarray(190, 206)).toString());
        const deadline = buf.readUInt32BE(206);
        const redeemerMsgLen = buf.readUInt32BE(210);
        const redeemerMessage = buf.subarray(214, 214 + redeemerMsgLen);
        return new FastMarketOrder(
            amountIn,
            minAmountOut,
            targetChain,
            targetDomain,
            redeemer,
            sender,
            refundAddress,
            Number(slowSequence),
            slowEmitter,
            maxFee,
            initAuctionFee,
            deadline,
            redeemerMessage
        );
    }
}

export class SlowOrderResponse {
    baseFee: bigint;

    constructor(baseFee: bigint) {
        this.baseFee = baseFee;
    }

    static get ID(): number {
        return 14;
    }

    static decode(payload: Buffer): SlowOrderResponse {
        const buf = takePayloadId(payload, this.ID);

        const baseFee = BigInt(ethers.BigNumber.from(buf.subarray(0, 16)).toString());

        return new SlowOrderResponse(baseFee);
    }
}

function takePayloadId(buf: Buffer, expectedId: number): Buffer {
    if (buf.readUInt8(0) != expectedId) {
        throw new Error("Invalid payload ID");
    }

    return buf.subarray(1);
}
