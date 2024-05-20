import {
    Layout,
    LayoutToType,
    NamedLayoutItem,
    ProperLayout,
    RoArray,
    column,
    constMap,
    layoutDiscriminator,
    layoutItems,
} from "@wormhole-foundation/sdk";

// Payloads contained within LL messages

// Note: these do _not_ have the payload id since they are contained
//  within the LL message
const fillLayout = [
    { name: "sourceChain", ...layoutItems.chainItem() },
    { name: "orderSender", ...layoutItems.universalAddressItem },
    { name: "redeemer", ...layoutItems.universalAddressItem },
    { name: "redeemerMessage", binary: "bytes", lengthSize: 2 },
] as const satisfies Layout;

const slowOrderResponseLayout = [
    { name: "baseFee", binary: "uint", size: 8 },
] as const satisfies Layout;

// prettier-ignore
// Note: the value here is an object becuase constmap seems to have a bug
//  with nested arrays and the layout is an array
const payloadLayouts = [
    ["Fill",              { id: 1, layout: fillLayout }],
    ["SlowOrderResponse", { id: 2, layout: slowOrderResponseLayout }],
] as const satisfies RoArray<[string, { id: number; layout: Layout }]>;

export const payloads = constMap(payloadLayouts);
export const payloadNames = column(payloadLayouts, 0);
export const payloadDiscriminator = layoutDiscriminator(
    column(payloadLayouts, 1).map((p) => p.layout),
);
export const payloadIds = <N extends PayloadName>(name: N): ReturnType<typeof payloads<N>>["id"] =>
    payloads(name).id;

type PayloadIdItem<N extends PayloadName> = ReturnType<
    typeof layoutItems.payloadIdItem<PayloadId<N>>
>;

export type PayloadName = Parameters<typeof payloads>[0];
export type PayloadId<N extends PayloadName> = ReturnType<typeof payloadIds<N>>;
export function payloadLayout<N extends PayloadName>(name: N): PayloadLayout<N> {
    const { id, layout } = payloads(name);
    return [layoutItems.payloadIdItem(id), ...layout] as Layout as PayloadLayout<N>;
}

type RawPayloadLayout<N extends PayloadName> = ReturnType<typeof payloads<N>>["layout"];
export type PayloadLayout<N extends PayloadName> = [PayloadIdItem<N>, ...RawPayloadLayout<N>];
export type PayloadType<N extends PayloadName> = LayoutToType<PayloadLayout<N>>;

const switchCase = <P extends PayloadName>(p: P) =>
    Object.values(payloads(p)) as [PayloadId<P>, RawPayloadLayout<P>];

// prettier-ignore
export const payloadLayoutSwitch = {
    name: "data",
    binary: "switch",
    idSize: 1,
    layouts: [
        switchCase("Fill"), 
        switchCase("SlowOrderResponse")
    ],
} as const satisfies NamedLayoutItem;

export type Fill = PayloadType<"Fill">;
export type SlowOrderResponse = PayloadType<"SlowOrderResponse">;
