import { getConfig, ZERO_ADDRESS } from "./helpers";
import { tryHexToNativeString } from "@certusone/wormhole-sdk";
import { IOrderRouter__factory } from "../src/types/factories/IOrderRouter__factory";
import { IOrderRouter, RouterInfoStruct } from "../src/types/ITokenRouter";
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

function createRouterInfo(config: object): RouterInfoStruct {
    const router = config as RouterInfoStruct;
    if (router.endpoint === ZERO_ADDRESS) {
        throw Error("Invalid router address");
    }
    return router;
}

async function addRouterInfo(
    chainId: string,
    tokenRouter: ITokenRouter,
    routerInfo: RouterInfoStruct
): Promise<void> {
    console.log(`Adding router info for chain ${chainId}`);
    console.log(routerInfo);
    const tx = await tokenRouter.addRouterInfo(chainId, routerInfo);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded chainId=${chainId}, txHash=${tx.hash}`);
    } else {
        console.log(`Failed to add router info for chain ${chainId}`);
    }
}

async function main() {
    const { network, chain, rpc, key } = getArgs();
    const config = getConfig(network, "tokenRouter")["routerInfo"];

    // Setup ethers wallet.
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    // Setup token router contract.
    const tokenRouter = ITokenRouter__factory.connect(
        ethers.utils.getAddress(tryHexToNativeString(config[chain].endpoint, chain)),
        wallet
    );

    // Add router info.
    for (const chainId of Object.keys(config)) {
        if (chainId == chain) {
            continue;
        }
        const routerInfo = createRouterInfo(config[chainId]);
        await addRouterInfo(chainId, tokenRouter, routerInfo);
    }
}

main();
