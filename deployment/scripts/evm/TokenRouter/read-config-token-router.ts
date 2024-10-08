import { evm } from "../../../helpers";
import { getOnChainTokenRouterConfiguration } from "./utils";
import { inspect } from "util";

evm.runOnEvms("read-config-token-router", async (chain, signer, log) => {
  const onChainConfig = await getOnChainTokenRouterConfiguration(chain);
  log(`TokenRouter configuration for chainId ${chain.chainId}:`);
  log(inspect(onChainConfig, { depth: null, colors: true, compact: true }));
});