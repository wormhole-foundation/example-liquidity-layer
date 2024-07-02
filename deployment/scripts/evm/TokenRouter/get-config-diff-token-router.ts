import { runOnEvms, ChainInfo, LoggerFn } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";

runOnEvms("get-config-diff-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const diff = await getConfigurationDifferences(chain);

  log(`TokenRouter configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);
});