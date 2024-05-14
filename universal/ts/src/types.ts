import { LayoutToType } from "@wormhole-foundation/sdk";
import {
    cctpDepositLayout,
    fastMarketOrderLayout,
    fillLayout,
    slowOrderResponseLayout,
} from "./layouts";

export type CctpDeposit = LayoutToType<typeof cctpDepositLayout>;
export type FastMarketOrder = LayoutToType<typeof fastMarketOrderLayout>;

export type Fill = LayoutToType<typeof fillLayout>;
export type SlowOrderResponse = LayoutToType<typeof slowOrderResponseLayout>;
