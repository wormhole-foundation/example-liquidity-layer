import { getPostedMessage } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Fill, LiquidityLayerMessage } from "../../src";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";

export async function getUsdcAtaBalance(connection: Connection, owner: PublicKey) {
    const { amount } = await getAccount(
        connection,
        getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, owner)
    );
    return amount;
}

export async function verifyFillMessage(
    connection: Connection,
    message: PublicKey,
    amount: bigint,
    targetDomain: number,
    expectedFill: Fill
) {
    const fillPayload = (await getPostedMessage(connection, message)).message.payload;
    const parsed = LiquidityLayerMessage.decode(fillPayload);

    expect(parsed.deposit?.header.amount).to.equal(amount);
    expect(parsed.deposit?.header.destinationCctpDomain).to.equal(targetDomain);
    expect(parsed.deposit?.message.fill).to.deep.equal(expectedFill);
}

export async function verifyFastFillMessage(
    connection: Connection,
    message: PublicKey,
    amount: bigint,
    expectedFill: Fill
) {
    const fillPayload = (await getPostedMessage(connection, message)).message.payload;
    const parsed = LiquidityLayerMessage.decode(fillPayload);

    expect(parsed.fastFill?.fill).to.deep.equal(expectedFill);
    expect(parsed.fastFill?.amount).to.equal(amount);
}
