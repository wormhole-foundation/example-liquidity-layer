import {
    CctpDeposit,
    Message,
    messages,
    payloads,
} from "@wormhole-foundation/example-liquidity-layer-definitions";

export const ID_DEPOSIT = messages("CctpDeposit").id;

export const ID_DEPOSIT_FILL = payloads("Fill").id;
export const ID_DEPOSIT_SLOW_ORDER_RESPONSE = payloads("SlowOrderResponse").id;

export class LiquidityLayerDeposit {
    message: CctpDeposit;
    constructor(message: CctpDeposit) {
        this.message = message;
    }
    static decode(buf: Buffer): LiquidityLayerDeposit {
        return new LiquidityLayerDeposit(Message.deserialize(new Uint8Array(buf)) as CctpDeposit);
    }
    encode(): Buffer {
        return Buffer.from(Message.serialize(this.message));
    }
}
