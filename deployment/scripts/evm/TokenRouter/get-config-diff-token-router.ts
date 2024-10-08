import { evm } from "../../../helpers";
import { getConfigurationDifferences, logDiff } from "./utils";

evm.runOnEvms("get-config-diff-token-router", async (chain, signer, log) => {
  const diff = await getConfigurationDifferences(chain);

  log(`TokenRouter configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);
});