import { TokenRouter } from "../../../contract-bindings";
import { ChainInfo, LoggerFn, getContractInstance, getContractAddress, runOnEvms } from "../../../helpers";
import { ethers } from "ethers";
import { getTokenRouterConfiguration } from "./utils";

runOnEvms("disable-router-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const tokenRouterAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const config = await getTokenRouterConfiguration(chain);

  if (config.disableRouterEndpoints === undefined)
    throw new Error(`disableRouterEndpoints not defined in config for chain ${chain.chainId}`);

  const isRouterDisabled = await Promise.all(
    config.disableRouterEndpoints.map(async chainId => {
      const endpoint = await tokenRouter.getRouterEndpoint(chainId);
      const domain = await tokenRouter.getDomain(chainId);

      // When a endpoint is disabled, the router and the domain are set to 0 but the mintRecipient still has a value
      return Number(endpoint.router) === 0 && Number(domain) === 0 && Number(endpoint.mintRecipient) !== 0; 
    })
  );

  for (const i in config.disableRouterEndpoints) {
    const chainId = config.disableRouterEndpoints[i];
    const isDisabled = isRouterDisabled[i];

    if (isDisabled) {
      log(`Router endpoint already disabled for wormholeChainId ${chainId}`);
      log('Please remove the chainId from the disableRouterEndpoints array.')
    } else {
      await tokenRouter.disableRouterEndpoint(chainId);
      log(`Router endpoint disabled for wormholeChainId ${chainId}`);
    };
  }
});