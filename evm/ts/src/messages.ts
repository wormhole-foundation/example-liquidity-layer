import { parseVaa as _parseVaa } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

const TOKEN_BRIDGE_INTEGRATOR_MESSAGE_IDX = 133;
const WORMHOLE_CCTP_INTEGRATOR_MESSAGE_IDX = 147;

export class TokenBridgeTransferHeader {
    // Amount being transferred (big-endian uint256)
    amount: bigint;
    // Address of the token. Left-zero-padded if shorter than 32 bytes
    token: Uint8Array;
    // Chain ID of the token
    tokenChain: number;
    // Address of the recipient. Left-zero-padded if shorter than 32 bytes
    redeemer: Uint8Array;
    // Chain ID of the recipient
    redeemerChain: number;
    // Address of the message sender. Left-zero-padded if shorter than 32 bytes
    fromAddress: Uint8Array;

    constructor(
        amount: bigint,
        token: Uint8Array,
        tokenChain: number,
        redeemer: Uint8Array,
        redeemerChain: number,
        fromAddress: Uint8Array
    ) {
        this.amount = amount;
        this.token = token;
        this.tokenChain = tokenChain;
        this.redeemer = redeemer;
        this.redeemerChain = redeemerChain;
        this.fromAddress = fromAddress;
    }

    static decodeCoreBridgeMessage(buf: Buffer): [TokenBridgeTransferHeader, Buffer] {
        if (buf.readUInt8(0) != 3) {
            throw new Error("Invalid Token Bridge Transfer message");
        }

        return TokenBridgeTransferHeader.decode(buf.subarray(1));
    }

    static decode(buf: Buffer): [TokenBridgeTransferHeader, Buffer] {
        const amount = BigInt(ethers.BigNumber.from(buf.subarray(0, 32)).toString());
        const token = Uint8Array.from(buf.subarray(32, 64));
        const tokenChain = buf.readUInt16BE(64);
        const redeemer = Uint8Array.from(buf.subarray(66, 98));
        const redeemerChain = buf.readUInt16BE(98);
        const fromAddress = Uint8Array.from(buf.subarray(100, 132));
        const payload = buf.subarray(132);

        return [
            new TokenBridgeTransferHeader(
                amount,
                token,
                tokenChain,
                redeemer,
                redeemerChain,
                fromAddress
            ),
            payload,
        ];
    }
}

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

export enum RevertType {
    SwapFailed,
}

export type LiquidityLayerMessageBody = {
    marketOrder?: MarketOrder;
    fill?: Fill;
    orderRevert?: OrderRevert;
};

export type CoreBridgeLiquidityLayerMessage = {
    header: {
        tokenBridge?: TokenBridgeTransferHeader;
        wormholeCctp?: WormholeCctpDepositHeader;
    };
    body: LiquidityLayerMessageBody;
};

export class MessageDecoder {
    tokenBridgeAddress: Buffer | Uint8Array;
    wormholeCctpAddress?: Buffer | Uint8Array;

    constructor(
        tokenBridgeAddress: Buffer | Uint8Array,
        wormholeCctpAddress?: Buffer | Uint8Array
    ) {
        this.tokenBridgeAddress = tokenBridgeAddress;
        this.wormholeCctpAddress = wormholeCctpAddress;
    }

    static decode(payload: Buffer): LiquidityLayerMessageBody {
        const payloadId = payload.readUInt8(0);
        switch (payloadId) {
            case MarketOrder.ID: {
                return { marketOrder: MarketOrder.decode(payload) };
            }
            case Fill.ID: {
                return { fill: Fill.decode(payload) };
            }
            case OrderRevert.ID: {
                return { orderRevert: OrderRevert.decode(payload) };
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
        if (emitter.equals(this.tokenBridgeAddress)) {
            return MessageDecoder.unsafeDecodeTokenBridgeTransferPayload(payload);
        } else if (
            this.wormholeCctpAddress !== undefined &&
            emitter.equals(this.wormholeCctpAddress)
        ) {
            return MessageDecoder.unsafeDecodeWormholeCctpPayload(payload);
        } else {
            throw new Error("unrecognized emitter");
        }
    }

    parseVaa(encodedVaa: Buffer) {
        const vaa = _parseVaa(encodedVaa);

        // TODO: return the token bridge or wormhole cctp message?

        return {
            vaa,
            decoded: this.decodeCoreBridgeMessage(vaa.emitterAddress, vaa.payload),
        };
    }

    static unsafeDecodeTokenBridgeTransferPayload(
        tokenBridgeMessage: Buffer
    ): CoreBridgeLiquidityLayerMessage {
        const [tokenBridge, payload] =
            TokenBridgeTransferHeader.decodeCoreBridgeMessage(tokenBridgeMessage);
        return {
            header: { tokenBridge },
            body: this.decode(payload),
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
}

export class MarketOrder {
    minAmountOut: bigint;
    targetChain: number;
    redeemer: Buffer;
    redeemerMessage: Buffer;
    sender: Buffer;
    refundAddress: Buffer;
    relayerFee: bigint;
    allowedRelayers: Buffer[];

    constructor(
        minAmountOut: bigint,
        targetChain: number,
        redeemer: Buffer,
        redeemerMessage: Buffer,
        sender: Buffer,
        refundAddress: Buffer,
        relayerFee: bigint,
        allowedRelayers: Buffer[]
    ) {
        this.minAmountOut = minAmountOut;
        this.targetChain = targetChain;
        this.redeemer = redeemer;
        this.redeemerMessage = redeemerMessage;
        this.sender = sender;
        this.refundAddress = refundAddress;
        this.relayerFee = relayerFee;
        this.allowedRelayers = allowedRelayers;
    }

    static get ID(): number {
        return 1;
    }

    static decode(payload: Buffer): MarketOrder {
        const buf = takePayloadId(payload, this.ID);

        const minAmountOut = BigInt(ethers.BigNumber.from(buf.subarray(0, 32)).toString());
        const targetChain = buf.readUInt16BE(32);
        const redeemer = buf.subarray(34, 66);
        const sender = buf.subarray(66, 98);
        const refundAddress = buf.subarray(98, 130);
        const relayerFee = BigInt(ethers.BigNumber.from(buf.subarray(130, 162)).toString());
        const allowedRelayersLen = buf.readUInt8(162);
        const allowedRelayers: Buffer[] = [];
        for (let i = 0; i < allowedRelayersLen; ++i) {
            const offset = 163 + i * 32;
            allowedRelayers.push(buf.subarray(offset, offset + 32));
        }

        const msgDataOffset = 163 + allowedRelayersLen * 32;
        const redeemerMsgLen = buf.readUInt32BE(msgDataOffset);
        const redeemerMessage = buf.subarray(4 + msgDataOffset, 4 + msgDataOffset + redeemerMsgLen);

        return new MarketOrder(
            minAmountOut,
            targetChain,
            redeemer,
            redeemerMessage,
            sender,
            refundAddress,
            relayerFee,
            allowedRelayers
        );
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
        return 16; // 0x10
    }

    static decode(payload: Buffer): Fill {
        const buf = takePayloadId(payload, this.ID);

        const sourceChain = buf.readUInt16BE(0);
        const orderSender = buf.subarray(2, 34);
        const redeemer = buf.subarray(34, 66);
        const redeemerMsgLen = buf.readUInt32BE(66);
        const redeemerMessage = buf.subarray(72, 72 + redeemerMsgLen);

        return new Fill(sourceChain, orderSender, redeemer, redeemerMessage);
    }
}

export class OrderRevert {
    reason: RevertType;
    refundAddress: Buffer;

    constructor(reason: RevertType, refundAddress: Buffer) {
        this.reason = reason;
        this.refundAddress = refundAddress;
    }

    static get ID(): number {
        return 32; // 0x20
    }

    static decode(payload: Buffer): OrderRevert {
        const buf = takePayloadId(payload, this.ID);

        const reason = buf.readUInt8(0) as RevertType;
        const refundAddress = buf.subarray(1, 33);

        return new OrderRevert(reason, refundAddress);
    }
}

function takePayloadId(buf: Buffer, expectedId: number): Buffer {
    if (buf.readUInt8(0) != expectedId) {
        throw new Error("Invalid payload ID");
    }

    return buf.subarray(1);
}
