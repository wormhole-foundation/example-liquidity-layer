import { Layout, layoutItems } from "@wormhole-foundation/sdk";

export const CCTP_DEPOSIT_PAYLOAD = 1;

export const wormholeCctpDepositHeaderLayout = [
    { name: "token", ...layoutItems.universalAddressItem },
    { name: "amount", ...layoutItems.amountItem },
    { name: "sourceDomain", ...layoutItems.circleDomainItem },
    { name: "targetDomain", ...layoutItems.circleDomainItem },
    { name: "nonce", ...layoutItems.circleNonceItem },
    { name: "fromAddress", ...layoutItems.universalAddressItem },
    { name: "mintRecipient", ...layoutItems.universalAddressItem },
    { name: "payload", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

// Common properties for Fill types
const basefillLayout = [
    { name: "sourceChain", ...layoutItems.chainItem() },
    { name: "orderSender", ...layoutItems.universalAddressItem },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

export const fillLayout = [
    layoutItems.payloadIdItem(1),
    ...basefillLayout,
] as const satisfies Layout;

export const fastFillLayout = [
    layoutItems.payloadIdItem(12),
    { name: "fillAmount", binary: "uint", size: 16 },
    ...basefillLayout,
] as const satisfies Layout;

export const fastMarketOrderLayout = [
    layoutItems.payloadIdItem(11),
    { name: "amountIn", binary: "uint", size: 8 },
    { name: "minAmountOut", binary: "uint", size: 8 },
    { name: "targetChain", ...layoutItems.chainItem() },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "sender", ...layoutItems.universalAddressItem },
    { name: "refundAddress", ...layoutItems.universalAddressItem },
    { name: "maxFee", binary: "uint", size: 8 },
    { name: "initAuctionFee", binary: "uint", size: 8 },
    { name: "deadline", binary: "uint", size: 32 },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

export const slowOrderResponseLayout = [
    layoutItems.payloadIdItem(2),
    { name: "baseFee", binary: "uint", size: 16 },
] as const satisfies Layout;
