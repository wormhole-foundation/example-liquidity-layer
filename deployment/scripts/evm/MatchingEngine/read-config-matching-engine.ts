import { runOnEvms, ChainInfo, LoggerFn } from "../../../helpers";
import { ethers } from "ethers";
import { getOnChainMachingEngineConfiguration } from "./utils";
import { inspect } from "util";

runOnEvms("read-config-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const onChainConfig = await getOnChainMachingEngineConfiguration(chain);
  log(`MatchingEngine configuration for chainId ${chain.chainId}:`);
  log(inspect(onChainConfig, { depth: null, colors: true, compact: true }));
});