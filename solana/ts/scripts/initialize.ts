import { Keypair, Connection } from "@solana/web3.js";
import * as tokenBridgeRelayer from "../src";
import {
    RPC,
    TOKEN_ROUTER_PID,
    TOKEN_BRIDGE_PID,
    CORE_BRIDGE_PID,
    FEE_RECIPIENT,
    ASSISTANT,
} from "./helpers/consts";
import { sendAndConfirmIx } from "./helpers/utils";
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

// This function processes the initialize transaction for the token bridge relayer.
async function initialize(connection: Connection, payer: Keypair) {
    // Create the initialization instruction.
    const createInitializeIx = await tokenBridgeRelayer.initializeIx(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        TOKEN_BRIDGE_PID,
        CORE_BRIDGE_PID,
        FEE_RECIPIENT,
        ASSISTANT
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, createInitializeIx, payer);

    if (tx !== undefined) {
        console.log("Transaction signature:", tx);
    } else {
        console.log("Transaction failed");
    }
}

async function main() {
    // Set up provider.
    const connection = new Connection(RPC, "confirmed");

    // Owner wallet.
    const { keyPair } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Create state.
    await initialize(connection, payer);
}

main();
