import { runOnEvms, ChainInfo, LoggerFn } from "../../../helpers";
import { ethers } from "ethers";
import { getOnChainMachingEngineConfiguration } from "./utils";
import { inspect } from "util";
import chalk from "chalk";

runOnEvms("read-config-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {

  console.warn(chalk.yellow("This script is deprecated due to the only MatchingEngine contract is deployed in Solana."))
  throw new Error("This script is deprecated due to the only MatchingEngine contract is deployed in Solana.");

  const onChainConfig = await getOnChainMachingEngineConfiguration(chain);
  log(`MatchingEngine configuration for chainId ${chain.chainId}:`);
  log(inspect(onChainConfig, { depth: null, colors: true, compact: true }));
});