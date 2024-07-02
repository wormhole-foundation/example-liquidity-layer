import { runOnEvms, ChainInfo, LoggerFn, getContractInstance, getContractAddress, getDependencyAddress, getAddressType } from "../../../helpers";
import { ethers } from "ethers";
import { deployImplementation, getTokenRouterConfiguration } from "./utils";
import { TokenRouter } from "../../../contract-bindings";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { UniversalAddress } from "@wormhole-foundation/sdk-definitions";

runOnEvms("upgrade-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const currentImplementationAddress = getContractAddress("TokenRouterImplementation", chain.chainId);
  const proxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const proxy = (await getContractInstance("TokenRouter", proxyAddress, chain)) as TokenRouter;
  const config = await getTokenRouterConfiguration(chain);

  log(`Checking immutables for TokenRouter`);
  checkImmutables(proxy, config, chain);

  const newImplementation = await deployImplementation(chain, signer, config, log);

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

  const mintRecipientAddressType = getAddressType(config.matchingEngineMintRecipient);
  const expectedMatchingEngineMintRecipient = (new UniversalAddress(config.matchingEngineMintRecipient, mintRecipientAddressType)).toString();
  const localMatchingEngineAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEngineAddressType = getAddressType(localMatchingEngineAddress);
  const expectedMatchingEngineAddress = (new UniversalAddress(localMatchingEngineAddress, matchingEngineAddressType)).toString();
  const tokenAddress = getDependencyAddress("token", chain.chainId);

  if (matchingEngineMintRecipient.toLowerCase() !== expectedMatchingEngineMintRecipient.toLowerCase())
    throw new Error(`MatchingEngineMintRecipient is an immutable value and cannot be changed.`);

  if (matchingEngineChain !== Number(config.matchingEngineChain))
    throw new Error(`MatchingEngineChain is an immutable value and cannot be changed.`);

  if (matchingEngineDomain !== Number(config.matchingEngineDomain))
    throw new Error(`MatchingEngineDomain is an immutable value and cannot be changed.`);

  if (matchingEngineAddress.toLowerCase() !== expectedMatchingEngineAddress.toLowerCase())
    throw new Error(`MatchingEngineAddress is an immutable value and cannot be changed.`);

  if (token.toLowerCase() !== tokenAddress.toLowerCase())
    throw new Error(`Token is an immutable value and cannot be changed.`);
}