import { fastMarketOrderLayout } from "@wormhole-foundation/example-liquidity-layer-definitions";
import {
    ChainId,
    UniversalAddress,
    deserializeLayout,
    isChain,
    serializeLayout,
    toChain,
    toChainId,
} from "@wormhole-foundation/sdk";
import { ID_DEPOSIT, LiquidityLayerDeposit } from "./deposit";

export * from "./deposit";

export const ID_FAST_MARKET_ORDER = 11;

export type FastMarketOrder = {
    // u64
    amountIn: bigint;
    // u64
    minAmountOut: bigint;
    targetChain: ChainId;
    redeemer: Array<number>;
    sender: Array<number>;
    refundAddress: Array<number>;
    // u64
    maxFee: bigint;
    // u64
    initAuctionFee: bigint;
    deadline: number;
    redeemerMessage: Buffer;
};

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
                } = deserializeLayout(fastMarketOrderLayout, new Uint8Array(buf));
                if (!isChain(targetChain)) {
                    throw new Error("Invalid target chain");
                }

                fastMarketOrder = {
                    amountIn,
                    minAmountOut,
                    targetChain: toChainId(targetChain),
                    redeemer: Array.from(redeemer.toUint8Array()),
                    sender: Array.from(sender.toUint8Array()),
                    refundAddress: Array.from(refundAddress.toUint8Array()),
                    maxFee,
                    initAuctionFee,
                    deadline,
                    redeemerMessage: Buffer.from(redeemerMessage),
                };
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
                } = fastMarketOrder;

                const messageBuf = serializeLayout(fastMarketOrderLayout, {
                    amountIn,
                    minAmountOut,
                    targetChain: toChain(targetChain),
                    redeemer: new UniversalAddress(new Uint8Array(redeemer)),
                    sender: new UniversalAddress(new Uint8Array(sender)),
                    refundAddress: new UniversalAddress(new Uint8Array(refundAddress)),
                    maxFee: maxFee,
                    initAuctionFee: initAuctionFee,
                    deadline: deadline,
                    redeemerMessage: new Uint8Array(redeemerMessage),
                });

                return Buffer.from(messageBuf);
            } else {
                throw new Error("Invalid Liquidity Layer message");
            }
        })();

        return buf;
    }
}
