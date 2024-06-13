import { runOnEvms, ChainInfo, LoggerFn, getContractInstance, getContractAddress, getDependencyAddress } from "../../../helpers";
import { ethers } from "ethers";
import { deployImplementation, getAddressAsBytes32, getTokenRouterConfiguration } from "./utils";
import { TokenRouter } from "../../../contract-bindings";
import { TokenRouterConfiguration } from "../../../config/config-types";

runOnEvms("upgrade-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const currentImplementationAddress = await getContractAddress("TokenRouterImplementation", chain.chainId);
  const proxyAddress = await getContractAddress("TokenRouterProxy", chain.chainId);
  const proxy = (await getContractInstance("TokenRouter", proxyAddress, chain)) as TokenRouter;
  const config = await getTokenRouterConfiguration(chain);

  log(`Checking immutables for TokenRouter`);
  checkImmutables(proxy, config, chain);

  const newImplementation = await deployImplementation(signer, config, log);

  log(`Upgrading TokenRouter implementation from ${currentImplementationAddress} to ${newImplementation.address}`);
  
  await proxy.upgradeContract(newImplementation.address);
});

async function checkImmutables(tokenRouter: TokenRouter, config: TokenRouterConfiguration, chain: ChainInfo) {
  const [
    token,
    matchingEngineMintRecipient,
    matchingEngineChain,
    matchingEngineDomain,
    matchingEngineAddress,
  ] = await Promise.all([
    tokenRouter.orderToken(),
    tokenRouter.matchingEngineMintRecipient(),
    tokenRouter.matchingEngineChain(),
    tokenRouter.matchingEngineDomain(),
    tokenRouter.matchingEngineAddress(),
  ]);

  const expectedMatchingEngineMintRecipient = getAddressAsBytes32(config.matchingEngineMintRecipient);
  const localMatchingEngineAddress = await getContractAddress("MatchingEngineProxy", chain.chainId);
  const expectedMatchingEngineAddress = getAddressAsBytes32(localMatchingEngineAddress);
  const tokenAddress = getDependencyAddress("token", chain.chainId);

  if (matchingEngineMintRecipient !== expectedMatchingEngineMintRecipient)
    throw new Error(`MatchingEngineMintRecipient is an immutable value and cannot be changed.`);

  if (matchingEngineChain !== Number(config.matchingEngineChain))
    throw new Error(`MatchingEngineChain is an immutable value and cannot be changed.`);

  if (matchingEngineDomain !== Number(config.matchingEngineDomain))
    throw new Error(`MatchingEngineDomain is an immutable value and cannot be changed.`);

  if (matchingEngineAddress !== expectedMatchingEngineAddress)
    throw new Error(`MatchingEngineAddress is an immutable value and cannot be changed.`);

  if (token !== tokenAddress)
    throw new Error(`Token is an immutable value and cannot be changed.`);
}