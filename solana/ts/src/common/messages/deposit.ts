import {
    fillLayout,
    slowOrderResponseLayout,
    wormholeCctpDepositHeaderLayout,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import {
    ChainId,
    UniversalAddress,
    deserializeLayout,
    serializeLayout,
    toChain,
    toChainId,
} from "@wormhole-foundation/sdk";

export const ID_DEPOSIT = 1;

export const ID_DEPOSIT_FILL = 1;
export const ID_DEPOSIT_SLOW_ORDER_RESPONSE = 2;

export type DepositHeader = {
    tokenAddress: Array<number>;
    amount: bigint;
    sourceCctpDomain: number;
    destinationCctpDomain: number;
    cctpNonce: bigint;
    burnSource: Array<number>;
    mintRecipient: Array<number>;
};

export type Fill = {
    sourceChain: ChainId;
    orderSender: Array<number>;
    redeemer: Array<number>;
    redeemerMessage: Buffer;
};

export type SlowOrderResponse = {
    // u64
    baseFee: bigint;
};

export type LiquidityLayerDepositMessage = {
    fill?: Fill;
    slowOrderResponse?: SlowOrderResponse;
};

export class LiquidityLayerDeposit {
    header: DepositHeader;
    message: LiquidityLayerDepositMessage;

    constructor(header: DepositHeader, message: LiquidityLayerDepositMessage) {
        this.header = header;
        this.message = message;
    }

    static decode(buf: Buffer): LiquidityLayerDeposit {
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

        const message = (() => {
            const depositPayloadId = payload.at(0);
            switch (depositPayloadId) {
                case ID_DEPOSIT_FILL: {
                    const { sourceChain, orderSender, redeemer, redeemerMessage } =
                        deserializeLayout(fillLayout, payload);
                    const fill: Fill = {
                        sourceChain: toChainId(sourceChain),
                        orderSender: Array.from(orderSender.toUint8Array()),
                        redeemer: Array.from(redeemer.toUint8Array()),
                        redeemerMessage: Buffer.from(redeemerMessage),
                    };
                    return { fill };
                }
                case ID_DEPOSIT_SLOW_ORDER_RESPONSE: {
                    const { baseFee } = deserializeLayout(slowOrderResponseLayout, payload);
                    return { slowOrderResponse: { baseFee } };
                }
                default: {
                    throw new Error("Invalid Liquidity Layer deposit message");
                }
            }
        })();

        return new LiquidityLayerDeposit(
            {
                tokenAddress: Array.from(token.toUint8Array()),
                amount,
                sourceCctpDomain: sourceDomain,
                destinationCctpDomain: targetDomain,
                cctpNonce: nonce,
                burnSource: Array.from(fromAddress.toUint8Array()),
                mintRecipient: Array.from(mintRecipient.toUint8Array()),
            },
            message,
        );
    }

    encode(): Buffer {
        const {
            header: {
                tokenAddress,
                amount,
                sourceCctpDomain,
                destinationCctpDomain,
                cctpNonce,
                burnSource,
                mintRecipient,
            },
            message: { fill, slowOrderResponse },
        } = this;

        const payload = (() => {
            if (fill !== undefined) {
                const { sourceChain, orderSender, redeemer, redeemerMessage } = fill;
                return serializeLayout(fillLayout, {
                    sourceChain: toChain(sourceChain),
                    orderSender: new UniversalAddress(new Uint8Array(orderSender)),
                    redeemer: new UniversalAddress(new Uint8Array(redeemer)),
                    redeemerMessage: new Uint8Array(redeemerMessage),
                });
            } else if (slowOrderResponse !== undefined) {
                const { baseFee } = slowOrderResponse;
                return serializeLayout(slowOrderResponseLayout, {
                    baseFee,
                });
            } else {
                throw new Error("Invalid Liquidity Layer deposit message");
            }
        })();

        return Buffer.from(
            serializeLayout(wormholeCctpDepositHeaderLayout, {
                token: new UniversalAddress(new Uint8Array(tokenAddress)),
                amount: amount,
                sourceDomain: sourceCctpDomain,
                targetDomain: destinationCctpDomain,
                nonce: cctpNonce,
                fromAddress: new UniversalAddress(new Uint8Array(burnSource)),
                mintRecipient: new UniversalAddress(new Uint8Array(mintRecipient)),
                payload,
            }),
        );
    }
}
