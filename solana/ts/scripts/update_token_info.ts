import { Keypair, Connection } from "@solana/web3.js";
import * as tokenBridgeRelayer from "../src";
import { BN } from "@project-serum/anchor";
import { RPC, TOKEN_ROUTER_PID } from "./helpers/consts";
import { sendAndConfirmIx } from "./helpers/utils";
import yargs from "yargs";
import * as fs from "fs";
import { PublicKey } from "@metaplex-foundation/js";

interface Args {
    keyPair: Uint8Array;
    mint: PublicKey;
    swapRate: BN | undefined;
    maxNativeSwapAmount: BN | undefined;
}

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "New Owner Keypair",
            require: true,
            string: true,
        },
        mint: {
            alias: "m",
            describe: "Mint",
            require: true,
            string: true,
        },
        swapRate: {
            alias: "s",
            describe: "Swap rate",
            require: false,
            string: true,
        },
        maxNativeSwapAmount: {
            alias: "n",
            describe: "Max native swap amount",
            require: false,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "mint" in argv) {
        const args: Args = {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            mint: new PublicKey(argv.mint),
            swapRate: undefined,
            maxNativeSwapAmount: undefined,
        };

        if ("swapRate" in argv) {
            args.swapRate = new BN(Number(argv.swapRate));
        }

        if ("maxNativeSwapAmount" in argv) {
            args.maxNativeSwapAmount = new BN(Number(argv.maxNativeSwapAmount));
        }

        return args;
    } else {
        throw Error("Invalid arguments");
    }
}

async function updateMaxNativeSwapAmount(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    maxNativeSwapAmount: BN
) {
    // Create the instruction.
    const updateMaxNativeSwapAmountIx = await tokenBridgeRelayer.updateMaxNativeSwapAmountIx(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        mint,
        maxNativeSwapAmount
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, updateMaxNativeSwapAmountIx, payer);
    if (tx === undefined) {
        console.log("Transaction failed");
    } else {
        console.log("Transaction successful:", tx);
    }
}

async function updateSwapRate(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    swapRate: BN
) {
    // Create the instruction.
    const updateSwapRateIx = await tokenBridgeRelayer.createUpdateSwapRateInstruction(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        mint,
        swapRate
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(connection, updateSwapRateIx, payer);
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
    const args = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(args.keyPair));

    // Update the swap rate.
    if (args.swapRate !== undefined) {
        await updateSwapRate(connection, payer, args.mint, args.swapRate);
    }

    // Update the max native swap amount.
    if (args.maxNativeSwapAmount !== undefined) {
        await updateMaxNativeSwapAmount(connection, payer, args.mint, args.maxNativeSwapAmount);
    }
}

main();
