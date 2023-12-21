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
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        pause: {
            alias: "p",
            describe: "Pause for transfer",
            require: true,
            boolean: true,
        },
    }).argv;

    if ("keyPair" in argv && "pause" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            pause: argv.pause,
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function setPauseForTransfers(connection: Connection, payer: Keypair, pause: boolean) {
    // Create the set pause for transfers transaction.
    const setPauseIx = await tokenBridgeRelayer.setPauseForTransfersIx(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        pause
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, setPauseIx, payer);

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
    const { keyPair, pause } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Set pause for transfers.
    await setPauseForTransfers(connection, payer, pause);
}

main();
