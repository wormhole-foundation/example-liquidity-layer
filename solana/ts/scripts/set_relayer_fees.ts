import { Keypair, Connection } from "@solana/web3.js";
import { ChainId } from "@certusone/wormhole-sdk";
import * as tokenBridgeRelayer from "../src";
import { RPC, TOKEN_ROUTER_PID } from "./helpers/consts";
import { sendAndConfirmIx } from "./helpers/utils";
import yargs from "yargs";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        network: {
            alias: "n",
            describe: "Network",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "network" in argv) {
        const network = argv.network;
        if (network !== "mainnet" && network !== "testnet") {
            throw Error("Invalid network");
        }
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            network: network,
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function set_relayer_fees(connection: Connection, payer: Keypair, relayerFees: RelayerFee[]) {
    for (const target of relayerFees) {
        // Create registration transaction.
        const createSetRelayerFeeIx = await tokenBridgeRelayer.updateRelayerFeeIx(
            connection,
            TOKEN_ROUTER_PID,
            payer.publicKey,
            target.chain,
            new BN(target.fee)
        );

        console.log(`\n Setting relayer fee, chain: ${target.chain}, fee: ${target.fee}`);

        // Send the transaction.
        const tx = await sendAndConfirmIx(connection, createSetRelayerFeeIx, payer);
        if (tx === undefined) {
            console.log("Transaction failed");
        } else {
            console.log("Transaction successful:", tx);
        }
    }
}

interface RelayerFee {
    chain: ChainId;
    fee: string;
}

function createConfig(object: any) {
    let config = [] as RelayerFee[];

    for (let key of Object.keys(object)) {
        let member = { chain: Number(key) as ChainId, fee: object[key] };
        config.push(member);
    }

    return config;
}

async function main() {
    // Set up provider.
    const connection = new Connection(RPC, "confirmed");

    // Owner wallet.
    const { keyPair, network } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Read in config file.
    const deploymentConfig = JSON.parse(
        fs.readFileSync(`${__dirname}/../../cfg/${network}Config.json`, "utf8")
    );

    // Convert to Config type.
    const config = createConfig(deploymentConfig["relayerFeesInUsd"]);
    if (config.length == undefined) {
        throw Error("Relayer fees not found");
    }

    // Set the relayer fees.
    await set_relayer_fees(connection, payer, config);
}

main();
