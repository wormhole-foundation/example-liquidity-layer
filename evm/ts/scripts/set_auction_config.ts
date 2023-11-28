import { getConfig } from "./helpers";
import { ChainId, coalesceChainId, tryHexToNativeString } from "@certusone/wormhole-sdk";
import { IMatchingEngine__factory, IMatchingEngine } from "../src/types/";
import { AuctionConfigStruct } from "../src/types/IMatchingEngine";
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

async function setAuctionConfig(
    chainId: string,
    engine: IMatchingEngine,
    auctionConfig: AuctionConfigStruct
): Promise<void> {
    console.log("Setting auction config");
    const tx = await engine.setAuctionConfig(auctionConfig);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
        console.log(`Txn succeeded chainId=${chainId}, txHash=${tx.hash}`);
    } else {
        console.log(`Failed to set the auction config`);
    }
}

async function main() {
    const { network, chain, rpc, key } = getArgs();
    const config = getConfig(network);
    const matchingEngineConfig = config["matchingEngine"];
    const auctionConfig: AuctionConfigStruct = config["auctionConfig"];

    if (auctionConfig == null || matchingEngineConfig == null) {
        throw Error("Invalid config");
    }

    // Setup ethers wallet.
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    const engineChainId = coalesceChainId(chain);
    if (engineChainId != (matchingEngineConfig.chain as ChainId)) {
        console.log(engineChainId, matchingEngineConfig.chainId);
        throw Error("Invalid chainId");
    }

    // Setup token router contract.
    const engine = IMatchingEngine__factory.connect(
        ethers.utils.getAddress(
            tryHexToNativeString(matchingEngineConfig["address"].substring(2), engineChainId)
        ),
        wallet
    );

    await setAuctionConfig(engineChainId.toString(), engine, auctionConfig);
}

main();
