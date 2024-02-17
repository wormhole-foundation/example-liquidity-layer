import { getConfig, ZERO_BYTES32 } from "./helpers";
import { coalesceChainId, tryHexToNativeString, ChainName } from "@certusone/wormhole-sdk";
import { ITokenRouter__factory } from "../src/types/factories/ITokenRouter__factory";
import { EndpointStruct, ITokenRouter } from "../src/types/ITokenRouter";
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
    chainId: string | number,
    tokenRouter: ITokenRouter,
    routerEndpoint: EndpointStruct,
    domain: number
): Promise<void> {
    const tx = await tokenRouter.addRouterEndpoint(chainId, routerEndpoint, domain);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded chainId=${chainId}, txHash=${tx.hash}`);
    } else {
        console.log(`Failed to add router info for chain ${chainId}`);
    }
}

async function setCctpAllowance(router: ITokenRouter): Promise<void> {
    console.log(`Setting CCTP allowance`);
    const tx = await router.setCctpAllowance(ethers.constants.MaxUint256);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded txHash=${tx.hash}`);
    } else {
        console.log(`Failed to set CCTP allowance`);
    }
}

async function main() {
    const { network, chain, rpc, key } = getArgs();
    const config = getConfig(network);
    const routers = config["routers"];

    if (routers == null) {
        throw Error("Invalid routers");
    }

    // Setup ethers wallet.
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    const routerChainId = coalesceChainId(chain);

    // Setup token router contract.
    const tokenRouter = ITokenRouter__factory.connect(
        ethers.utils.getAddress(tryHexToNativeString(routers[chain].address.substring(2), chain)),
        wallet
    );

    // Set CCTP allowance.
    await setCctpAllowance(tokenRouter);

    // Add router info.
    for (const chainName of Object.keys(routers)) {
        const chainId = coalesceChainId(chainName as ChainName);
        if (chainId == routerChainId) {
            continue;
        }
        if (routers[chainName].address == ZERO_BYTES32) {
            throw Error(`Invalid endpoint for ${chainName}`);
        }

        await addRouterInfo(
            chainId,
            tokenRouter,
            {
                router: "0x" + routers[chainName].address,
                mintRecipient: "0x" + routers[chainName].mintRecipient,
            },
            routers[chainName].protocol.cctp.domain
        );
    }
}

main();
