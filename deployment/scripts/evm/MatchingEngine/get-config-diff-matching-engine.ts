import { runOnEvms, ChainInfo, LoggerFn } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";

runOnEvms("get-config-diff-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const diff = await getConfigurationDifferences(chain);
  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);
});