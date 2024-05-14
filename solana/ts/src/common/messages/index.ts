import {
    FastMarketOrder,
    fastMarketOrderLayout,
    payloadIds,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { deserializeLayout, isChain, serializeLayout } from "@wormhole-foundation/sdk";
import { ID_DEPOSIT, LiquidityLayerDeposit } from "./deposit";

export * from "./deposit";

export const ID_FAST_MARKET_ORDER = payloadIds.FAST_MARKET_ORDER;

export class LiquidityLayerMessage {
    deposit?: LiquidityLayerDeposit;
    fastMarketOrder?: FastMarketOrder;

    constructor(message: { deposit?: LiquidityLayerDeposit; fastMarketOrder?: FastMarketOrder }) {
        const { deposit, fastMarketOrder } = message;
        this.deposit = deposit;
        this.fastMarketOrder = fastMarketOrder;
    }

    static decode(buf: Buffer): LiquidityLayerMessage {
        const payloadId = buf.readUInt8(0);

        let deposit: LiquidityLayerDeposit | undefined;
        let fastMarketOrder: FastMarketOrder | undefined;

        switch (payloadId) {
            case ID_DEPOSIT: {
                deposit = LiquidityLayerDeposit.decode(buf);
                break;
            }
            case ID_FAST_MARKET_ORDER: {
                fastMarketOrder = deserializeLayout(fastMarketOrderLayout, new Uint8Array(buf));
                if (!isChain(fastMarketOrder.targetChain)) throw new Error("Invalid target chain");
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
                return Buffer.from(serializeLayout(fastMarketOrderLayout, fastMarketOrder));
            } else {
                throw new Error("Invalid Liquidity Layer message");
            }
        })();

        return buf;
    }
}
