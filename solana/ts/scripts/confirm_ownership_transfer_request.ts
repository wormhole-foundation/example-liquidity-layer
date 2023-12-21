import { Keypair, Connection } from "@solana/web3.js";
import * as tokenBridgeRelayer from "../src";
import { RPC, TOKEN_ROUTER_PID } from "./helpers/consts";
import { sendAndConfirmIx } from "./helpers/utils";
import yargs from "yargs";
import * as fs from "fs";

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "New Owner Keypair",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv) {
        return {
            newOwnerKeyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function confirmOwnershipTransferRequest(connection: Connection, payer: Keypair) {
    // Create the submit ownership transfer request transaction.
    const confirmOwnershipTransferRequestIx = await tokenBridgeRelayer.confirmOwnershipTransferIx(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, confirmOwnershipTransferRequestIx, payer);

    if (tx === undefined) {
        console.log("Transaction failed");
    } else {
        console.log("Transaction successful:", tx);
    }
}

async function main() {
    // Set up provider.
    const connection = new Connection(RPC, "confirmed");

    // Owner wallet.
    const { newOwnerKeyPair } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(newOwnerKeyPair));

    // Confirm ownership transfer request.
    await confirmOwnershipTransferRequest(connection, payer);
}

main();
