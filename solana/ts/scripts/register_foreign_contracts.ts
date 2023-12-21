import { Keypair, Connection } from "@solana/web3.js";
import { ChainId } from "@certusone/wormhole-sdk";
import * as tokenBridgeRelayer from "../src";
import { RPC, TOKEN_ROUTER_PID, TOKEN_BRIDGE_PID } from "./helpers/consts";
import { sendAndConfirmIx } from "./helpers/utils";
import { BN } from "@coral-xyz/anchor";
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

function validateContractAddress(address: string) {
    if (address.length != 64 || address.substring(0, 2) == "0x") {
        throw Error("Invalid contract address");
    }
}

async function register_foreign_contract(
    connection: Connection,
    payer: Keypair,
    foreignContract: ForeignContract[]
) {
    for (const contract of foreignContract) {
        // Validate contract addresses.
        validateContractAddress(contract.relayerAddress);
        validateContractAddress(contract.tokenBridgeAddress);

        // TODO: check current registration before creating instruction.

        // Create registration transaction.
        const registerForeignContractIx =
            await tokenBridgeRelayer.createRegisterForeignContractInstruction(
                connection,
                TOKEN_ROUTER_PID,
                payer.publicKey,
                TOKEN_BRIDGE_PID,
                contract.chain,
                Buffer.from(contract.relayerAddress, "hex"),
                "0x" + contract.tokenBridgeAddress,
                contract.relayerFee
            );

        console.log("\n Registering foreign contract:");
        console.log(contract);

        // Send the transaction.
        const tx = await sendAndConfirmIx(connection, registerForeignContractIx, payer);

        if (tx === undefined) {
            console.log("Transaction failed");
        } else {
            console.log("Transaction successful:", tx);
        }
    }
}

interface ForeignContract {
    chain: ChainId;
    relayerAddress: string;
    tokenBridgeAddress: string;
    relayerFee: BN;
}

function createConfig(contracts: any, fees: any): ForeignContract[] {
    let config = [] as ForeignContract[];

    for (let key of Object.keys(contracts)) {
        let member = {
            chain: Number(key) as ChainId,
            relayerAddress: contracts[key]["relayer"],
            tokenBridgeAddress: contracts[key]["tokenBridge"],
            relayerFee: new BN(fees[key]),
        };
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
    const config = createConfig(
        deploymentConfig["deployedContracts"],
        deploymentConfig["relayerFeesInUsd"]
    );
    if (config.length == undefined) {
        throw Error("Deployed contracts not found");
    }

    // Register foreign contracts.
    await register_foreign_contract(connection, payer, config);
}

main();
