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
        mintRecipient: Uint8Array,
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
                mintRecipient,
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
        const raw = payload.toString("hex");

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
        messagePayload: Buffer | Uint8Array,
    ) {
        const emitter = Buffer.from(emitterAddress);
        const payload = Buffer.from(messagePayload);
        if (this.wormholeCctpAddress !== undefined && emitter.equals(this.wormholeCctpAddress)) {
            return MessageDecoder.unsafeDecodeWormholeCctpPayload(payload);
        } else {
            throw new Error("unrecognized emitter");
        }
    }

    static unsafeDecodeWormholeCctpPayload(
        wormholeCctpMessage: Buffer,
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
        redeemerMessage: Buffer,
    ) {
        this.sourceChain = sourceChain;
        this.orderSender = orderSender;
        this.redeemer = redeemer;
        this.redeemerMessage = redeemerMessage;
    }

    static get ID(): number {
        return 1;
    }

    static decode(payload: Buffer): Fill {
        const buf = takePayloadId(payload, this.ID);

        const sourceChain = buf.readUInt16BE(0);
        const orderSender = buf.subarray(2, 34);
        const redeemer = buf.subarray(34, 66);
        const redeemerMsgLen = buf.readUInt16BE(66);
        const redeemerMessage = buf.subarray(68, 68 + redeemerMsgLen);

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
        fillAmount: bigint,
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

        const fillAmount = buf.readBigUInt64BE(0);
        const sourceChain = buf.readUInt16BE(8);
        const orderSender = buf.subarray(10, 42);
        const redeemer = buf.subarray(42, 74);
        const redeemerMsgLen = buf.readUInt16BE(74);
        const redeemerMessage = buf.subarray(76, 76 + redeemerMsgLen);

        return new FastFill(sourceChain, orderSender, redeemer, redeemerMessage, fillAmount);
    }
}

export class FastMarketOrder {
    amountIn: bigint;
    minAmountOut: bigint;
    targetChain: number;
    redeemer: Buffer;
    sender: Buffer;
    refundAddress: Buffer;
    maxFee: bigint;
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;

    constructor(
        amountIn: bigint,
        minAmountOut: bigint,
        targetChain: number,
        redeemer: Buffer,
        sender: Buffer,
        refundAddress: Buffer,
        maxFee: bigint,
        initAuctionFee: bigint,
        deadline: number,
        redeemerMessage: Buffer,
    ) {
        this.amountIn = amountIn;
        this.minAmountOut = minAmountOut;
        this.targetChain = targetChain;
        this.redeemer = redeemer;
        this.sender = sender;
        this.refundAddress = refundAddress;
        this.maxFee = maxFee;
        this.initAuctionFee = initAuctionFee;
        this.deadline = deadline;
        this.redeemerMessage = redeemerMessage;
    }

    static get ID(): number {
        return 11;
    }

    static decode(payload: Buffer): FastMarketOrder {
        const buf = takePayloadId(payload, this.ID);

        const amountIn = buf.readBigUInt64BE(0);
        const minAmountOut = buf.readBigUInt64BE(8);
        const targetChain = buf.readUInt16BE(16);
        const redeemer = buf.subarray(18, 50);
        const sender = buf.subarray(50, 82);
        const refundAddress = buf.subarray(82, 114);
        const maxFee = buf.readBigUInt64BE(114);
        const initAuctionFee = buf.readBigUInt64BE(122);
        const deadline = buf.readUInt32BE(130);
        const redeemerMsgLen = buf.readUInt16BE(134);
        const redeemerMessage = buf.subarray(136, 136 + redeemerMsgLen);
        return new FastMarketOrder(
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
        );
    }
}

export class SlowOrderResponse {
    baseFee: bigint;

    constructor(baseFee: bigint) {
        this.baseFee = baseFee;
    }

    static get ID(): number {
        return 2;
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
