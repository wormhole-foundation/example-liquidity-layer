export * from "./config";
export * as evm from "./evm";
export * from "./logger";
export * from "./wormscan";
export * from "./settleAuction";
export * from "./sendTx";
export * from "./preparePostVaaTx";
export * from "./placeInitialOffer";

import { Connection, PublicKey } from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import { LiquidityLayerMessage } from "@wormhole-foundation/example-liquidity-layer-solana/common";
import {
    FastMarketOrder,
    SlowOrderResponse,
    payloads,
} from "@wormhole-foundation/example-liquidity-layer-definitions";

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export async function getUsdcAtaBalance(connection: Connection, owner: PublicKey) {
    const { amount } = await splToken.getAccount(
        connection,
        splToken.getAssociatedTokenAddressSync(USDC_MINT, owner),
    );
    return amount;
}

export async function isBalanceSufficient(
    connection: Connection,
    owner: PublicKey,
    amount: bigint,
) {
    return (await getUsdcAtaBalance(connection, owner)) >= amount;
}

export function tryParseFastMarketOrder(payload: Buffer): FastMarketOrder | undefined {
    try {
        let { fastMarketOrder } = LiquidityLayerMessage.decode(payload);
        if (fastMarketOrder === undefined) {
            return undefined;
        } else {
            return fastMarketOrder;
        }
    } catch (err: any) {
        return undefined;
    }
}

export function tryParseSlowOrderResponse(payload: Buffer): SlowOrderResponse | undefined {
    try {
        const { deposit } = LiquidityLayerMessage.decode(payload);
        if (
            deposit === undefined ||
            deposit.message.payload.id !== payloads("SlowOrderResponse").id
        ) {
            return undefined;
        } else {
            return deposit.message.payload;
        }
    } catch (err: any) {
        return undefined;
    }
}
