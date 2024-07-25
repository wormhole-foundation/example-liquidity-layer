import { evm, ChainInfo, getContractInstance, getContractAddress, getDependencyAddress, ecosystemChains, solana } from "../../../helpers";
import { deployImplementation, getMatchingEngineMintRecipientAddress, getTokenRouterConfiguration, matchingEngineChain, matchingEngineDomain } from "./utils";
import { TokenRouter } from "../../../contract-bindings";
import { UniversalAddress, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { Connection } from "@solana/web3.js";

evm.runOnEvms("upgrade-token-router", async (chain, signer, log) => {
  const currentImplementationAddress = getContractAddress("TokenRouterImplementation", chain.chainId);
  const proxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const proxy = (await getContractInstance("TokenRouter", proxyAddress, chain)) as TokenRouter;
  const config = await getTokenRouterConfiguration(chain);

  // TODO: write a `getChain(chainId: ChainId): ChainInfo` function to replace these lines
  if (ecosystemChains.solana.networks.length !== 1) {
    throw Error("Unexpected number of Solana networks.");
  }
  const solanaRpc = ecosystemChains.solana.networks[0].rpc;

  const solanaConnection = new Connection(solanaRpc, solana.connectionCommitmentLevel);
  const matchingEngineMintRecipient = toUniversal("Solana", getMatchingEngineMintRecipientAddress(solanaConnection));

  log(`Checking immutables for TokenRouter`);
  checkImmutables(proxy, chain, matchingEngineMintRecipient);

  const newImplementation = await deployImplementation(signer, config, matchingEngineMintRecipient, log);

  log(`Upgrading TokenRouter implementation from ${currentImplementationAddress} to ${newImplementation.address}`);

  await proxy.upgradeContract(newImplementation.address);
});

async function checkImmutables(tokenRouter: TokenRouter, chain: ChainInfo, matchingEngineMintRecipient: UniversalAddress) {
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

  const localMatchingEngineAddress = getContractAddress("MatchingEngine", matchingEngineChain);
  const matchingEngineAddress = toUniversal("Solana", localMatchingEngineAddress).toString();
  const tokenAddress = getDependencyAddress("token", chain.chainId);

  if (savedMatchingEngineMintRecipient.toLowerCase() !== matchingEngineMintRecipient.toString().toLowerCase())
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