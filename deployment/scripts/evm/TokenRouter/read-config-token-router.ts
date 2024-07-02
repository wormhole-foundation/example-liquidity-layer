import { runOnEvms, ChainInfo, LoggerFn } from "../../../helpers";
import { ethers } from "ethers";
import { getOnChainTokenRouterConfiguration } from "./utils";
import { inspect } from "util";

runOnEvms("read-config-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const onChainConfig = await getOnChainTokenRouterConfiguration(chain);
  log(`TokenRouter configuration for chainId ${chain.chainId}:`);
  log(inspect(onChainConfig, { depth: null, colors: true, compact: true }));
});