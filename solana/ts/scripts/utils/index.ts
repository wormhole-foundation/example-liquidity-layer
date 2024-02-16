export * from "./expiringList";
export * from "./config";
export * as evm from "./evm";
export * from "./logger";
export * from "./sourceTxHash";
export * from "./sendTx";
export * from "./preparePostVaaTx";
export * from "./placeInitialOffer";
export * from "./settleAuction";

import { Connection, PublicKey } from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import { ParsedVaaWithBytes } from "@wormhole-foundation/relayer-engine";
import { FastMarketOrder, LiquidityLayerMessage, SlowOrderResponse } from "../../src";

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

export function tryParseFastMarketOrder(
    signedVaa: ParsedVaaWithBytes,
): FastMarketOrder | undefined {
    const { payload } = signedVaa;
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

export function tryParseSlowOrderResponse(
    signedVaa: ParsedVaaWithBytes,
): SlowOrderResponse | undefined {
    const { payload } = signedVaa;
    try {
        const { deposit } = LiquidityLayerMessage.decode(payload);
        if (deposit === undefined || deposit.message.slowOrderResponse === undefined) {
            return undefined;
        } else {
            return deposit.message.slowOrderResponse;
        }
    } catch (err: any) {
        return undefined;
    }
}
