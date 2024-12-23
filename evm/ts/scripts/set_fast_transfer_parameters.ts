import { getConfig } from "./helpers";
import { ITokenRouter__factory } from "../src/types/factories/ITokenRouter__factory";
import { ITokenRouter, FastTransferParametersStruct } from "../src/types/ITokenRouter";
import { ethers } from "ethers-v5";
import { toChain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";

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

async function setFastTransferParams(
    chainId: string,
    tokenRouter: ITokenRouter,
    params: FastTransferParametersStruct,
): Promise<void> {
    console.log(`Updating fast transfer parameters`);
    const tx = await tokenRouter.updateFastTransferParameters(params);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded chainId=${chainId}, txHash=${tx.hash}`);
    } else {
        console.log(`Failed to update fast transfer parameters ${chainId}`);
    }
}

async function main() {
    const { network, chain, rpc, key } = getArgs();
    const config = getConfig(network);
    const routers = config["routers"];
    const fastTransferParams: FastTransferParametersStruct = config["fastTransferParameters"];

    if (routers == null || fastTransferParams == null) {
        throw Error("Invalid routers");
    }

    // Setup ethers wallet.
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    const routerChainId = toChainId(chain);
    const routerChain = toChain(routerChainId);
    const routerAddress = toUniversal(routerChain, routers[routerChainId].address)
        .toNative(routerChain)
        .toString();

    // Setup token router contract.
    const tokenRouter = ITokenRouter__factory.connect(routerAddress, wallet);

    await setFastTransferParams(routerChainId.toString(), tokenRouter, fastTransferParams);
}

main();
