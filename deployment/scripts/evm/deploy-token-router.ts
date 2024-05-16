import { ethers } from "ethers";
import { ERC1967Proxy__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { ChainId } from "@certusone/wormhole-sdk";
import { runOnEvms, ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress } from "../../helpers";
import { MatchingEngineConfiguration, TokenRouterConfiguration } from "../../config/config-types";

import { MatchingEngine__factory, TokenRouter__factory } from "../../contract-bindings";
import { TokenRouter } from "../../../evm/ts/src/types";

runOnEvms("deploy-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const config = await getTokenRouterConfiguration(chain);
  const implementation = await deployImplementation(signer, config, log);
  const proxy = await deployProxy(signer, config, implementation, log);

});

function getTokenRouterConfiguration (chain: ChainInfo): Promise<TokenRouterConfiguration> {
  return getChainConfig<TokenRouterConfiguration>("token-router", chain.chainId);
}

async function deployImplementation (signer: ethers.Signer, config: TokenRouterConfiguration, log: LoggerFn) {
  const factory = new TokenRouter__factory(signer);

  const token = getDependencyAddress("Token", config.chainId);
  const wormhole = getDependencyAddress("Wormhole", config.chainId);
  const tokenMessenger = getDependencyAddress("TokenMessenger", config.chainId);

  // TODO: ensure that this is a 32-byte address?
  const matchingEngineAddress = await getContractAddress(
    "MatchingEngineProxies", 
    Number(config.matchingEngineChain) as ChainId
  );

  const deployment = await factory.deploy(
    token,
    wormhole,
    tokenMessenger,
    config.matchingEngineChain,
    matchingEngineAddress,
    config.matchingEngineMintRecipient,
    config.matchingEngineDomain,
    {} // overrides
  );

  await deployment.deployed();

  log(`TokenRouter deployed at ${deployment.address}`);

  writeDeployedContract(config.chainId, "TokenRouterImplementations", deployment.address);

  return deployment;
}

async function deployProxy (signer: ethers.Signer, config: TokenRouterConfiguration, implementation: ethers.Contract, log: LoggerFn) {
  const factory = new ERC1967Proxy__factory(signer);

  const abi = ["function initialize(address)"];
  const iface = new ethers.utils.Interface(abi);
  const encodedCall = iface.encodeFunctionData("initialize", [config.ownerAssistant]);

  const deployment = await factory.deploy(
    implementation.address,
    encodedCall,
  );

  await deployment.deployed();

  log(`TokenRouterProxy deployed at ${deployment.address}`);

  writeDeployedContract(config.chainId, "TokenRouterProxies", deployment.address);

  return deployment;
}
