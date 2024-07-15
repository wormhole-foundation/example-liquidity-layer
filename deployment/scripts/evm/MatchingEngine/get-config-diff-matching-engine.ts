import { runOnEvms, ChainInfo, LoggerFn } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";
import chalk from "chalk";

runOnEvms("get-config-diff-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {

  console.warn(chalk.yellow("This script is deprecated due to the only MatchingEngine contract is deployed in Solana."))
  throw new Error("This script is deprecated due to the only MatchingEngine contract is deployed in Solana.");

  const diff = await getConfigurationDifferences(chain);
  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);
});