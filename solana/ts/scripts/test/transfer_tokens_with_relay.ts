import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { ChainId } from "@certusone/wormhole-sdk";
import * as tokenBridgeRelayer from "../../src";
import { RPC, TOKEN_BRIDGE_PID, TOKEN_ROUTER_PID, CORE_BRIDGE_PID } from "../helpers/consts";
import { sendAndConfirmIx } from "../helpers/utils";
import yargs from "yargs";
import * as fs from "fs";

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function transfer_native(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    params: SendTokensParams
) {
    // Create registration transaction.
    const transferIx = await tokenBridgeRelayer.createTransferNativeTokensWithRelayInstruction(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        TOKEN_BRIDGE_PID,
        CORE_BRIDGE_PID,
        mint,
        params
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, transferIx, payer, 250000);
    if (tx === undefined) {
        console.log("Transaction failed:", tx);
    } else {
        console.log("Transaction successful:", tx);
    }
}

async function transfer_wrapped(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    params: SendTokensParams
) {
    // Create registration transaction.
    const transferIx = await tokenBridgeRelayer.createTransferWrappedTokensWithRelayInstruction(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        TOKEN_ROUTER_PID,
        CORE_BRIDGE_PID,
        mint,
        params
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, transferIx, payer, 250000);
    if (tx === undefined) {
        console.log("Transaction failed:", tx);
    } else {
        console.log("Transaction successful:", tx);
    }
}

export interface SendTokensParams {
    amount: number;
    toNativeTokenAmount: number;
    recipientAddress: Buffer;
    recipientChain: ChainId;
    batchId: number;
    wrapNative: boolean;
}

async function main() {
    // Set up provider.
    const connection = new Connection(RPC, "confirmed");

    // Owner wallet.
    const { keyPair } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Add transfer params here.
    const sendParams: SendTokensParams = {
        amount: 10000000,
        toNativeTokenAmount: 0,
        recipientAddress: Buffer.from(
            "0000000000000000000000003278E0aE2bc9EC8754b67928e0F5ff8f99CE5934",
            "hex"
        ),
        recipientChain: 6, // avax
        batchId: 0,
        wrapNative: true,
    };

    // Token mint.
    const isWrapped = false;
    const mint = new PublicKey("So11111111111111111111111111111111111111112");

    // Do the transfer.
    if (isWrapped) {
        await transfer_native(connection, payer, mint, sendParams);
    } else {
        await transfer_native(connection, payer, mint, sendParams);
    }
}

main();
