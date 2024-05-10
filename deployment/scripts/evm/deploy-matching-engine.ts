import { ethers } from "ethers";
import { runOnEvms, ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract } from "../../helpers";
import { MatchingEngineConfiguration } from "../../config/config-types";

import { MatchingEngine__factory, ERC1967Upgrade__factory } from "../../contract-bindings";
import { ERC1967Proxy__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";

runOnEvms("deploy-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const config = await getMachingEngineConfiguration(chain);
  const implementation = await deployImplementation(signer, config, log);
  const proxy = await deployProxy(signer, config, implementation, log);

});

function getMachingEngineConfiguration (chain: ChainInfo): Promise<MatchingEngineConfiguration> {
  return getChainConfig<MatchingEngineConfiguration>("matching-engine", chain.chainId);
}

async function deployImplementation (signer: ethers.Signer, config: MatchingEngineConfiguration, log: LoggerFn) {
  const factory = new MatchingEngine__factory(signer);
  const token = getDependencyAddress("Token", config.chainId);
  const wormhole = getDependencyAddress("Wormhole", config.chainId);
  const tokenMessenger = getDependencyAddress("TokenMessenger", config.chainId);
  const deployment = await factory.deploy(
    token,
    wormhole,
    tokenMessenger,
    config.userPenaltyRewardBps,
    config.initialPenaltyBps,
    config.auctionDuration,
    config.auctionGracePeriod,
    config.auctionPenaltyBlocks,
    {} // overrides
  );

  await deployment.deployed();

  log(`MatchingEngine deployed at ${deployment.address}`);

  writeDeployedContract(config.chainId, "MatchingEngineImplementations", deployment.address);

  return deployment;
}

async function deployProxy (signer: ethers.Signer, config: MatchingEngineConfiguration, implementation: ethers.Contract, log: LoggerFn) {
  const factory = new ERC1967Proxy__factory(signer);

  const abi = ["function initialize(address,address)"];
  const iface = new ethers.utils.Interface(abi);
  const encodedCall = iface.encodeFunctionData("initialize", [config.ownerAssistant, config.feeRecipient]);

  const deployment = await factory.deploy(
    implementation.address,
    encodedCall,
  );

  await deployment.deployed();

  log(`MatchingEngineProxy deployed at ${deployment.address}`);

  writeDeployedContract(config.chainId, "MatchingEngineProxies", deployment.address);

  return deployment;
}
