import {
    Message,
    MessageType,
    Payload,
    PayloadName,
    PayloadType,
    messages,
    payloads,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { toChainId } from "@wormhole-foundation/sdk-base";

export type LiquidityLayerMessageBody = {
    fill?: Fill;
    fastFill?: FastFill;
    slowOrderResponse?: SlowOrderResponse;
    fastMarketOrder?: FastMarketOrder;
};

export type CoreBridgeLiquidityLayerMessage = {
    header: { wormholeCctp?: WormholeCctpDepositHeader };
    body: LiquidityLayerMessageBody;
};

export class MessageDecoder {
    static decode(vaa: Uint8Array): CoreBridgeLiquidityLayerMessage {
        const msg = Message.deserialize(vaa);
        if (Message.is(msg, "CctpDeposit")) {
            const payload = msg.payload;
            return {
                header: { wormholeCctp: WormholeCctpDepositHeader.fromLayout(msg) },
                body: {
                    fill: Payload.is(payload, "Fill") ? Fill.fromLayout(payload) : undefined,
                    slowOrderResponse: Payload.is(payload, "SlowOrderResponse")
                        ? SlowOrderResponse.fromLayout(payload)
                        : undefined,
                },
            };
        }

        return {
            header: {},
            body: {
                fastFill: Message.is(msg, "FastFill") ? FastFill.fromLayout(msg) : undefined,
                fastMarketOrder: Message.is(msg, "FastMarketOrder")
                    ? FastMarketOrder.fromLayout(msg)
                    : undefined,
            },
        };
    }
}

export class WormholeCctpDepositHeader {
    constructor(
        public token: Uint8Array,
        public amount: bigint,
        public sourceDomain: number,
        public targetDomain: number,
        public nonce: bigint,
        public fromAddress: Uint8Array,
        public mintRecipient: Uint8Array,
        public payload: PayloadType<PayloadName>,
    ) {}
    static get ID(): number {
        return messages("CctpDeposit").id;
    }
    static fromLayout(data: MessageType<"CctpDeposit">): WormholeCctpDepositHeader {
        const {
            tokenAddress,
            amount,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
            payload,
        } = data;

        return new WormholeCctpDepositHeader(
            tokenAddress.toUint8Array(),
            amount,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            burnSource.toUint8Array(),
            mintRecipient.toUint8Array(),
            payload,
        );
    }

    static decode(buf: Buffer): WormholeCctpDepositHeader {
        return this.fromLayout(
            Message.deserialize(new Uint8Array(buf)) as MessageType<"CctpDeposit">,
        );
    }
}

export class FastFill {
    constructor(
        public sourceChain: number,
        public orderSender: Buffer,
        public redeemer: Buffer,
        public redeemerMessage: Buffer,
        public fillAmount: bigint,
    ) {}

    static get ID(): number {
        return messages("FastFill").id;
    }
    static fromLayout(data: MessageType<"FastFill">): FastFill {
        const { sourceChain, orderSender, redeemer, redeemerMessage, fillAmount } = data;
        return new FastFill(
            toChainId(sourceChain),
            Buffer.from(orderSender.toUint8Array()),
            Buffer.from(redeemer.toUint8Array()),
            Buffer.from(redeemerMessage),
            fillAmount,
        );
    }
    static decode(payload: Buffer): FastFill {
        return this.fromLayout(
            Message.deserialize(new Uint8Array(payload)) as MessageType<"FastFill">,
        );
    }
}

export class FastMarketOrder {
    constructor(
        public amountIn: bigint,
        public minAmountOut: bigint,
        public targetChain: number,
        public redeemer: Buffer,
        public sender: Buffer,
        public refundAddress: Buffer,
        public maxFee: bigint,
        public initAuctionFee: bigint,
        public deadline: number,
        public redeemerMessage: Buffer,
    ) {}
    static get ID(): number {
        return messages("FastMarketOrder").id;
    }
    static fromLayout(data: MessageType<"FastMarketOrder">): FastMarketOrder {
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
        } = data;

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

    static decode(payload: Buffer): FastMarketOrder {
        return this.fromLayout(
            Message.deserialize(new Uint8Array(payload)) as MessageType<"FastMarketOrder">,
        );
    }
}

export class Fill {
    constructor(
        public sourceChain: number,
        public orderSender: Buffer,
        public redeemer: Buffer,
        public redeemerMessage: Buffer,
    ) {}
    static get ID(): number {
        return payloads("Fill").id;
    }
    static fromLayout(data: PayloadType<"Fill">): Fill {
        const { sourceChain, orderSender, redeemer, redeemerMessage } = data;
        return new Fill(
            toChainId(sourceChain),
            Buffer.from(orderSender.toUint8Array()),
            Buffer.from(redeemer.toUint8Array()),
            Buffer.from(redeemerMessage),
        );
    }
    static decode(payload: Buffer): Fill {
        return this.fromLayout(Payload.deserialize(new Uint8Array(payload)) as PayloadType<"Fill">);
    }
}

export class SlowOrderResponse {
    constructor(public baseFee: bigint) {}
    static get ID(): number {
        return payloads("SlowOrderResponse").id;
    }
    static fromLayout(data: PayloadType<"SlowOrderResponse">): SlowOrderResponse {
        return new SlowOrderResponse(data.baseFee);
    }
    static decode(payload: Buffer): SlowOrderResponse {
        return this.fromLayout(
            Payload.deserialize(new Uint8Array(payload)) as PayloadType<"SlowOrderResponse">,
        );
    }
}
