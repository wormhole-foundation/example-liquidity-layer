import {
    CctpDeposit,
    Fill,
    SlowOrderResponse,
    cctpDepositLayout,
    fillLayout,
    payloadIds,
    slowOrderResponseLayout,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { deserializeLayout, serializeLayout } from "@wormhole-foundation/sdk";

export const ID_DEPOSIT = payloadIds.CCTP_DEPOSIT;

export const ID_DEPOSIT_FILL = payloadIds.FILL;
export const ID_DEPOSIT_SLOW_ORDER_RESPONSE = payloadIds.SLOW_ORDER_RESPONSE;

export type LiquidityLayerDepositMessage = {
    fill?: Fill;
    slowOrderResponse?: SlowOrderResponse;
};

export class LiquidityLayerDeposit {
    header: CctpDeposit;
    message: LiquidityLayerDepositMessage;

    constructor(header: CctpDeposit, message: LiquidityLayerDepositMessage) {
        this.header = header;
        this.message = message;
    }

    static decode(buf: Buffer): LiquidityLayerDeposit {
        const header = deserializeLayout(cctpDepositLayout, new Uint8Array(buf));

        const message = (() => {
            const depositPayloadId = header.payload.at(0);
            switch (depositPayloadId) {
                case ID_DEPOSIT_FILL: {
                    return { fill: deserializeLayout(fillLayout, header.payload) };
                }
                case ID_DEPOSIT_SLOW_ORDER_RESPONSE: {
                    return {
                        slowOrderResponse: deserializeLayout(
                            slowOrderResponseLayout,
                            header.payload,
                        ),
                    };
                }
                default: {
                    throw new Error("Invalid Liquidity Layer deposit message");
                }
            }
        })();

        return new LiquidityLayerDeposit(header, message);
    }

    encode(): Buffer {
        const {
            header,
            message: { fill, slowOrderResponse },
        } = this;

        // @ts-ignore -- payload is readonly
        header.payload = (() => {
            if (fill !== undefined) {
                return serializeLayout(fillLayout, fill);
            } else if (slowOrderResponse !== undefined) {
                return serializeLayout(slowOrderResponseLayout, slowOrderResponse);
            } else {
                throw new Error("Invalid Liquidity Layer deposit message");
            }
        })();

        return Buffer.from(serializeLayout(cctpDepositLayout, header));
    }
}
