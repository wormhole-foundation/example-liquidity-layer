import { parseVaa as _parseVaa } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

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
    fill?: Fill;
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
        return 1; // 0x1
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

function takePayloadId(buf: Buffer, expectedId: number): Buffer {
    if (buf.readUInt8(0) != expectedId) {
        throw new Error("Invalid payload ID");
    }

    return buf.subarray(1);
}
