import {
  getConfig,
  MATCHING_ENGINE_ADDRESS,
  ZERO_BYTES32,
  ZERO_ADDRESS,
} from "./helpers";
import { CHAIN_ID_AVAX, tryHexToNativeString } from "@certusone/wormhole-sdk";
import { IMatchingEngine__factory } from "../src/types/factories/IMatchingEngine__factory";
import { IMatchingEngine } from "../src/types/IMatchingEngine";
import { ethers } from "ethers";

export function getArgs() {
  const argv = require("yargs")
    .required("network")
    .required("rpc")
    .required("key").argv;

  const network = argv.network;
  if (network !== "mainnet" && network !== "testnet") {
    throw Error("Invalid network");
  }
  return {
    network: network,
    rpc: argv.rpc,
    key: argv.key,
  };
}

interface Route {
  router: string;
  target: string;
  cctp: boolean;
  poolIndex: number;
}

function createExecutionRoute(config: object): Route {
  const route = config as Route;
  if (route.router === ZERO_ADDRESS) {
    throw Error("Invalid router address");
  }
  if (route.target === ZERO_ADDRESS) {
    throw Error("Invalid target address");
  }
  return route;
}

async function enableExecutionRoute(
  chainId: string,
  matchingEngine: IMatchingEngine,
  route: Route
): Promise<void> {
  console.log(`Registering route for chain ${chainId}`);
  console.log(route);
  const tx = await matchingEngine.enableExecutionRoute(
    chainId,
    route.router,
    route.target,
    route.cctp,
    route.poolIndex
  );
  const receipt = await tx.wait();

  if (receipt.status === 1) {
    console.log(
      `Registration txn succeeded chainId=${chainId}, txHash=${tx.hash}`
    );
  } else {
    console.log(`Failed to register route for chain ${chainId}`);
  }
}

async function main() {
  const { network, rpc, key } = getArgs();
  const config = getConfig(network, "matchingEngine")["executionRoutes"];

  // Setup ethers wallet.
  const provider = new ethers.providers.StaticJsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(key, provider);

  // Setup matching engine contract.
  const matchingEngine = IMatchingEngine__factory.connect(
    ethers.utils.getAddress(
      tryHexToNativeString(MATCHING_ENGINE_ADDRESS, CHAIN_ID_AVAX)
    ),
    wallet
  );

  // Register order routers and set the execution routes.
  for (const chainId of Object.keys(config)) {
    const registered = await matchingEngine.getOrderRouter(chainId);
    if (registered === ZERO_BYTES32) {
      const route = createExecutionRoute(config[chainId]);
      await enableExecutionRoute(chainId, matchingEngine, route);
    } else {
      console.log(`Route already enabled for chain ${chainId}`);
    }
  }
}

main();
