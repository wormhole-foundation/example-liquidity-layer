import { getConfig, ZERO_BYTES32 } from "./helpers";
import { IMatchingEngine__factory, IMatchingEngine } from "../src/types/";
import { RouterEndpointStruct } from "../src/types/IMatchingEngine";
import { ethers } from "ethers";
import { ChainId, toChain, toChainId } from "@wormhole-foundation/sdk-base";
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

async function addRouterInfo(
    chainId: string,
    engine: IMatchingEngine,
    routerEndpoint: RouterEndpointStruct,
    domain: string,
): Promise<void> {
    console.log(`Adding router endpoint for chain ${chainId}`);
    const tx = await engine.addRouterEndpoint(chainId, routerEndpoint, domain);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded chainId=${chainId}, txHash=${tx.hash}`);
    } else {
        console.log(`Failed to add router info for chain ${chainId}`);
    }
}

async function setCctpAllowance(engine: IMatchingEngine): Promise<void> {
    console.log(`Setting CCTP allowance`);
    const tx = await engine.setCctpAllowance(ethers.constants.MaxUint256);
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
    const matchingEngineConfig = config["matchingEngine"];
    const routers = config["routers"];

    if (routers == null || matchingEngineConfig == null) {
        throw Error("Invalid config");
    }

    // Setup ethers wallet.
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    const engineChainId = toChainId(chain);
    if (engineChainId != (matchingEngineConfig.chain as ChainId)) {
        console.log(engineChainId, matchingEngineConfig.chainId);
        throw Error("Invalid chainId");
    }

    const engineChain = toChain(engineChainId);
    const engineAddress = toUniversal(engineChain, matchingEngineConfig["address"])
        .toNative(engineChain)
        .toString();

    // Setup token router contract.
    const engine = IMatchingEngine__factory.connect(engineAddress.toString(), wallet);

    // Set CCTP allowance.
    await setCctpAllowance(engine);

    // Add router info.
    for (const chainId of Object.keys(routers)) {
        if (routers[chainId].address == ZERO_BYTES32) {
            throw Error(`Invalid endpoint for chain ${chainId}`);
        }
        const targetRouter = routers[chainId];

        await addRouterInfo(
            chainId,
            engine,
            { router: targetRouter.address, mintRecipient: targetRouter.mintRecipient },
            targetRouter.domain,
        );
    }
}

main();
