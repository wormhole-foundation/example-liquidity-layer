import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as tokenBridgeRelayer from "../src";
import { RPC, TOKEN_ROUTER_PID } from "./helpers/consts";
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
        newAssistant: {
            alias: "n",
            describe: "New Owner Assistant",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "newAssistant" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            newAssistant: new PublicKey(argv.newAssistant),
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function update_owner_assistant(
    connection: Connection,
    payer: Keypair,
    newAssistant: PublicKey
) {
    // Create the instruction.
    const deregisterTokenIx = await tokenBridgeRelayer.createUpdateAssistantInstruction(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        newAssistant
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, deregisterTokenIx, payer);
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
    const { keyPair, newAssistant } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Update the owner assistant.
    await update_owner_assistant(connection, payer, newAssistant);
}

main();
