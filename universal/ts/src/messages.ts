import {
    Layout,
    LayoutToType,
    RoArray,
    column,
    constMap,
    layoutDiscriminator,
    layoutItems,
} from "@wormhole-foundation/sdk";
import { payloadLayoutSwitch } from "./payloads";

const cctpDepositLayout = [
    { name: "tokenAddress", ...layoutItems.universalAddressItem },
    { name: "amount", ...layoutItems.amountItem },
    { name: "sourceCctpDomain", ...layoutItems.circleDomainItem },
    { name: "destinationCctpDomain", ...layoutItems.circleDomainItem },
    { name: "cctpNonce", ...layoutItems.circleNonceItem },
    { name: "burnSource", ...layoutItems.universalAddressItem },
    { name: "mintRecipient", ...layoutItems.universalAddressItem },
    {
        name: "payload",
        binary: "bytes",
        lengthSize: 2,
        layout: payloadLayoutSwitch,
    },
] as const satisfies Layout;
export type CctpDeposit = LayoutToType<typeof cctpDepositLayout>;

const fastMarketOrderLayout = [
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
export type FastMarketOrder = LayoutToType<typeof fastMarketOrderLayout>;

const fastFillLayout = [
    { name: "fillAmount", binary: "uint", size: 8 },
    { name: "sourceChain", ...layoutItems.chainItem() },
    { name: "orderSender", ...layoutItems.universalAddressItem },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;
export type FastFill = LayoutToType<typeof fastFillLayout>;

// prettier-ignore
const messageLayouts = [
    ["CctpDeposit",     { id: 1,  layout: cctpDepositLayout }],
    ["FastMarketOrder", { id: 11, layout: fastMarketOrderLayout }],
    ["FastFill",        { id: 12, layout: fastFillLayout }],
] as const satisfies RoArray<[string, { id: number; layout: Layout }]>;

export const messages = constMap(messageLayouts);
export const messageNames = column(messageLayouts, 0);
export const messageIds = <N extends MessageName>(name: N): ReturnType<typeof messages<N>>["id"] =>
    messages(name).id;
export const messageDiscriminator = layoutDiscriminator(messageNames.map((m) => messageLayout(m)));

type PayloadIdItem<N extends MessageName> = ReturnType<
    typeof layoutItems.payloadIdItem<MessageId<N>>
>;

export type MessageName = Parameters<typeof messages>[0];
export type MessageId<N extends MessageName> = ReturnType<typeof messageIds<N>>;
export type MessageLayout<N extends MessageName> = [
    PayloadIdItem<N>,
    ...ReturnType<typeof messages<N>>["layout"],
];
export type MessageType<N extends MessageName> = LayoutToType<MessageLayout<N>>;

export function messageLayout<N extends MessageName>(name: N): MessageLayout<N> {
    const { id, layout } = messages(name);
    return [layoutItems.payloadIdItem(id), ...layout] as Layout as MessageLayout<N>;
}
