import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import yargs from "yargs";
import * as fs from "fs";

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        rpc: {
            alias: "r",
            describe: "rpc",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "rpc" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            rpc: argv.rpc,
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function main() {
    // Owner wallet.
    const { keyPair, rpc } = getArgs();
    const connection = new Connection(rpc, "confirmed");
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Create associated token account.
    const tx = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        USDC_MINT,
        payer.publicKey
    );

    console.log("ATA", tx);
}

main();
