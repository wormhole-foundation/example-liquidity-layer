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
        mint: {
            alias: "m",
            describe: "Mint",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "mint" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            mint: new PublicKey(argv.mint),
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function deregister_token(connection: Connection, payer: Keypair, mint: PublicKey) {
    // Create the deregister token instruction.
    const deregisterTokenIx = await tokenBridgeRelayer.createDeregisterTokenInstruction(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        mint
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
    const { keyPair, mint } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Deregister token.
    await deregister_token(connection, payer, mint);
}

main();
