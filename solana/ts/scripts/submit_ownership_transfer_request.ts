import { Keypair, Connection } from "@solana/web3.js";
import * as tokenBridgeRelayer from "../src";
import { RPC, TOKEN_ROUTER_PID } from "./helpers/consts";
import { sendAndConfirmIx } from "./helpers/utils";
import yargs from "yargs";
import * as fs from "fs";
import { PublicKey } from "@metaplex-foundation/js";

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        newOwner: {
            alias: "p",
            describe: "New owner public key",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "newOwner" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            newOwner: new PublicKey(argv.newOwner),
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function submitOwnershipTransferRequest(
    connection: Connection,
    payer: Keypair,
    newOwner: PublicKey
) {
    // Create the submit ownership transfer request transaction.
    const submitOwnershipTransferRequestIx = await tokenBridgeRelayer.submitOwnershipTransferIx(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        newOwner
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, submitOwnershipTransferRequestIx, payer);

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
    const { keyPair, newOwner } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Submit ownership transfer request.
    await submitOwnershipTransferRequest(connection, payer, newOwner);
}

main();
