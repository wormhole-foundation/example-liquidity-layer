import { deserializeLayout, toChainId } from "@wormhole-foundation/sdk";
import {
    fastFillLayout,
    fastMarketOrderLayout,
    fillLayout,
    slowOrderResponseLayout,
    wormholeCctpDepositHeaderLayout,
} from "@wormhole-foundation/example-liquidity-layer-definitions";

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
        const {
            token,
            amount,
            sourceDomain,
            targetDomain,
            nonce,
            fromAddress,
            mintRecipient,
            payload,
        } = deserializeLayout(wormholeCctpDepositHeaderLayout, new Uint8Array(buf));

        return [
            new WormholeCctpDepositHeader(
                token.toUint8Array(),
                amount,
                sourceDomain,
                targetDomain,
                nonce,
                fromAddress.toUint8Array(),
                mintRecipient.toUint8Array(),
            ),
            Buffer.from(payload),
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
        const { sourceChain, orderSender, redeemer, redeemerMessage } = deserializeLayout(
            fillLayout,
            new Uint8Array(payload),
        );
        return new Fill(
            toChainId(sourceChain),
            Buffer.from(orderSender.toUint8Array()),
            Buffer.from(redeemer.toUint8Array()),
            Buffer.from(redeemerMessage),
        );
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
        const { sourceChain, orderSender, redeemer, redeemerMessage, fillAmount } =
            deserializeLayout(fastFillLayout, new Uint8Array(payload));

        return new FastFill(
            toChainId(sourceChain),
            Buffer.from(orderSender.toUint8Array()),
            Buffer.from(redeemer.toUint8Array()),
            Buffer.from(redeemerMessage),
            fillAmount,
        );
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
        } = deserializeLayout(fastMarketOrderLayout, new Uint8Array(payload));

        return new FastMarketOrder(
            amountIn,
            minAmountOut,
            toChainId(targetChain),
            Buffer.from(redeemer.toUint8Array()),
            Buffer.from(sender.toUint8Array()),
            Buffer.from(refundAddress.toUint8Array()),
            maxFee,
            initAuctionFee,
            deadline,
            Buffer.from(redeemerMessage),
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
        const deser = deserializeLayout(slowOrderResponseLayout, new Uint8Array(payload));
        return new SlowOrderResponse(deser.baseFee);
    }
}
