import { getConfig, ZERO_BYTES32 } from "./helpers";
import { tryHexToNativeString } from "@certusone/wormhole-sdk";
import { ITokenRouter__factory } from "../src/types/factories/ITokenRouter__factory";
import { ITokenRouter } from "../src/types/ITokenRouter";
import { ethers } from "ethers";

export function getArgs() {
    const argv = require("yargs")
        .required("network")
        .required("chain")
        .required("rpc")
        .required("key").argv;

    const network = argv.network;
    if (network !== "mainnet" && network !== "testnet") {
        throw Error("Invalid network");
    }
    return {
        network: network,
        chain: argv.chain,
        rpc: argv.rpc,
        key: argv.key,
    };
}

async function addRouterInfo(
    chainId: string,
    tokenRouter: ITokenRouter,
    routerEndpoint: string
): Promise<void> {
    console.log(`Adding router endpoint for chain ${chainId}`);
    const tx = await tokenRouter.addRouterEndpoint(chainId, routerEndpoint);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded chainId=${chainId}, txHash=${tx.hash}`);
    } else {
        console.log(`Failed to add router info for chain ${chainId}`);
    }
}

async function main() {
    const { network, chain, rpc, key } = getArgs();
    const config = getConfig(network, "tokenRouter")["routers"];

    // Setup ethers wallet.
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    // Setup token router contract.
    const tokenRouter = ITokenRouter__factory.connect(
        ethers.utils.getAddress(tryHexToNativeString(config[chain].substring(2), chain)),
        wallet
    );

    // Add router info.
    for (const chainId of Object.keys(config)) {
        if (chainId == chain) {
            continue;
        }
        if (config[chainId].endpoint == ZERO_BYTES32) {
            throw Error(`Invalid endpoint for chain ${chainId}`);
        }

        await addRouterInfo(chainId, tokenRouter, config[chainId]);
    }
}

main();
