import { evm, ChainInfo, getContractInstance, getContractAddress, getDependencyAddress, getChainInfo } from "../../../helpers";
import { deployImplementation, getMatchingEngineMintRecipientAddress, getTokenRouterConfiguration, matchingEngineChain, matchingEngineDomain } from "./utils";
import { TokenRouter } from "../../../contract-bindings";
import { UniversalAddress, toUniversal } from "@wormhole-foundation/sdk-definitions";


evm.runOnEvms("upgrade-token-router", async (chain, signer, log) => {
  const currentImplementationAddress = getContractAddress("TokenRouterImplementation", chain.chainId);
  const proxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const proxy = (await getContractInstance("TokenRouter", proxyAddress, chain)) as TokenRouter;
  const config = await getTokenRouterConfiguration(chain);

  const matchingEngineMintRecipient = getMatchingEngineMintRecipientAddress();

  log(`Checking immutables for TokenRouter`);
  checkImmutables(proxy, chain, matchingEngineMintRecipient);

  const newImplementation = await deployImplementation(chain, signer, config, matchingEngineMintRecipient, log);

  log(`Upgrading TokenRouter implementation from ${currentImplementationAddress} to ${newImplementation.address}`);

  await proxy.upgradeContract(newImplementation.address);
});

async function checkImmutables(tokenRouter: TokenRouter, chain: ChainInfo, matchingEngineMintRecipient: string) {
  const [
    token,
    savedMatchingEngineMintRecipient,
    savedMatchingEngineChain,
    savedMatchingEngineDomain,
    savedMatchingEngineAddress,
  ] = await Promise.all([
    tokenRouter.orderToken(),
    tokenRouter.matchingEngineMintRecipient(),
    tokenRouter.matchingEngineChain(),
    tokenRouter.matchingEngineDomain(),
    tokenRouter.matchingEngineAddress(),
  ]);

  const localMatchingEngineAddress = getContractAddress("MatchingEngineProxy", matchingEngineChain);
  const matchingEngineAddress = toUniversal("Solana", localMatchingEngineAddress).toString();
  const tokenAddress = getDependencyAddress("token", chain);

  if (savedMatchingEngineMintRecipient.toLowerCase() !== matchingEngineMintRecipient.toLowerCase())
    throw new Error(`MatchingEngineMintRecipient is an immutable value and cannot be changed.`);

  if (savedMatchingEngineChain !== matchingEngineChain)
    throw new Error(`MatchingEngineChain is an immutable value and cannot be changed.`);

  if (savedMatchingEngineDomain !== matchingEngineDomain)
    throw new Error(`MatchingEngineDomain is an immutable value and cannot be changed.`);

  if (savedMatchingEngineAddress.toLowerCase() !== matchingEngineAddress.toLowerCase())
    throw new Error(`MatchingEngineAddress is an immutable value and cannot be changed.`);

  if (token.toLowerCase() !== tokenAddress.toLowerCase())
    throw new Error(`Token is an immutable value and cannot be changed.`);
}