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
        newFeeRecipient: {
            alias: "n",
            describe: "New Fee Recipient",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "newFeeRecipient" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            newFeeRecipient: new PublicKey(argv.newFeeRecipient),
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function update_fee_recipient(
    connection: Connection,
    payer: Keypair,
    newFeeRecipient: PublicKey
) {
    // Create the instruction.
    const updateFeeRecipientIx = await tokenBridgeRelayer.updateFeeRecipientIx(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        newFeeRecipient
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, updateFeeRecipientIx, payer);
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
    const { keyPair, newFeeRecipient } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Update the fee recipient.
    await update_fee_recipient(connection, payer, newFeeRecipient);
}

main();
