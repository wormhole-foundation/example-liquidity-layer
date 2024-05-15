import { Layout, layoutItems } from "@wormhole-foundation/sdk";

export const payloadIds = {
    // LL payloads
    CCTP_DEPOSIT: 1,
    // 2-10 are reserved for future use
    FAST_MARKET_ORDER: 11,
    FAST_FILL: 12,

    // Payloads contained within the deposit payload
    FILL: 1,
    SLOW_ORDER_RESPONSE: 2,
} as const;

type Payload = keyof typeof payloadIds;
const payloadId = (p: Payload) => layoutItems.payloadIdItem(payloadIds[p]);

export const fillLayout = [
    payloadId("FILL"),
    { name: "sourceChain", ...layoutItems.chainItem() },
    { name: "orderSender", ...layoutItems.universalAddressItem },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

export const fastFillLayout = [
    payloadId("FAST_FILL"),
    { name: "fillAmount", binary: "uint", size: 8 },
    { name: "sourceChain", ...layoutItems.chainItem() },
    { name: "orderSender", ...layoutItems.universalAddressItem },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

export const slowOrderResponseLayout = [
    payloadId("SLOW_ORDER_RESPONSE"),
    { name: "baseFee", binary: "uint", size: 8 },
] as const satisfies Layout;

export const cctpDepositLayout = [
    payloadId("CCTP_DEPOSIT"),
    { name: "tokenAddress", ...layoutItems.universalAddressItem },
    { name: "amount", ...layoutItems.amountItem },
    { name: "sourceCctpDomain", ...layoutItems.circleDomainItem },
    { name: "destinationCctpDomain", ...layoutItems.circleDomainItem },
    { name: "cctpNonce", ...layoutItems.circleNonceItem },
    { name: "burnSource", ...layoutItems.universalAddressItem },
    { name: "mintRecipient", ...layoutItems.universalAddressItem },
    { name: "payload", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

export const fastMarketOrderLayout = [
    payloadId("FAST_MARKET_ORDER"),
    { name: "amountIn", binary: "uint", size: 8 },
    { name: "minAmountOut", binary: "uint", size: 8 },
    { name: "targetChain", ...layoutItems.chainItem() },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "sender", ...layoutItems.universalAddressItem },
    { name: "refundAddress", ...layoutItems.universalAddressItem },
    { name: "maxFee", binary: "uint", size: 8 },
    { name: "initAuctionFee", binary: "uint", size: 8 },
    { name: "deadline", binary: "uint", size: 4 },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;
