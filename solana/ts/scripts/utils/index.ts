export * from "./expiringList";
export * from "./config";
export * as evm from "./evm";
export * from "./logger";
export * from "./sourceTxHash";
export * from "./sendTx";
export * from "./preparePostVaaTx";

import { Connection, PublicKey } from "@solana/web3.js";
import * as splToken from "@solana/spl-token";

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export async function getUsdcAtaBalance(connection: Connection, owner: PublicKey) {
    const { amount } = await splToken.getAccount(
        connection,
        splToken.getAssociatedTokenAddressSync(USDC_MINT, owner)
    );
    return amount;
}

export async function isBalanceSufficient(
    connection: Connection,
    owner: PublicKey,
    amount: bigint
) {
    return (await getUsdcAtaBalance(connection, owner)) >= amount;
}
