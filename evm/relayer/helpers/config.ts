import { ChainId } from "@certusone/wormhole-sdk";
import { getAddress } from "ethers/lib/utils";
import * as fs from "fs";

export interface Router {
  chain: ChainId;
  router: string;
  cctp: string;
  wormhole: string;
}

export interface RelayerConfig {
  matchingEngineAddress: string;
  matchingEngineChain: ChainId;
  usdc: string;
  routers: Router[];
}

export function getRelayerConfig(): RelayerConfig {
  const configPath = `${__dirname}/../cfg/fast-relayer.json`;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const routers: Router[] = [];

  if (config.routers !== undefined) {
    for (const chainId of Object.keys(config.routers)) {
      const router = config.routers[chainId];
      routers.push({
        chain: parseInt(chainId) as ChainId,
        router: getAddress(router.router),
        cctp: getAddress(router.cctp),
        wormhole: getAddress(router.wormhole),
      });
    }
  } else {
    throw new Error("No routers defined in config");
  }

  const relayerConfig: RelayerConfig = {
    matchingEngineAddress: getAddress(config.matchingEngineAddress),
    matchingEngineChain: config.matchingEngineChain,
    usdc: getAddress(config.usdc),
    routers: routers,
  };

  return relayerConfig;
}
