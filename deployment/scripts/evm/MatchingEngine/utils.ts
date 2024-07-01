import { ethers } from "ethers";
import { MatchingEngineConfiguration } from "../../../config/config-types";
import { MatchingEngine, MatchingEngine__factory } from "../../../contract-bindings";
import { ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress, getContractInstance, getRouterEndpointDifferences, logComparision, someoneIsDifferent } from "../../../helpers";
import { ERC20 } from "../../../contract-bindings/out/ERC20";

export function getMachingEngineConfiguration(chain: ChainInfo): Promise<MatchingEngineConfiguration> {
  return getChainConfig<MatchingEngineConfiguration>("matching-engine", chain.chainId);
}

export async function deployImplementation(signer: ethers.Signer, config: MatchingEngineConfiguration, log: LoggerFn) {
  const factory = new MatchingEngine__factory(signer);
  const token = getDependencyAddress("token", config.chainId).toString();
  const wormhole = getDependencyAddress("wormhole", config.chainId).toString();
  const tokenMessenger = getDependencyAddress("tokenMessenger", config.chainId).toString();
  const MAX_BPS_FEE = 1000000;

  // State validations
  if (Number(config.auctionDuration) === 0) {
    throw new Error(`Auction duration must be greater than 0.`);
  }
  if (Number(config.auctionGracePeriod) <= Number(config.auctionDuration)) {
    throw new Error(`Auction grace period must be greater than auction duration.`);
  }
  if (Number(config.userPenaltyRewardBps) > MAX_BPS_FEE) {
    throw new Error(`User penalty reward bps must be less than or equal to ${MAX_BPS_FEE}.`);
  }
  if (Number(config.initialPenaltyBps) > MAX_BPS_FEE) {
    throw new Error(`Initial penalty bps must be less than or equal to ${MAX_BPS_FEE}.`);
  }

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

  const constructorArgs = [
    token,
    wormhole,
    tokenMessenger,
    config.userPenaltyRewardBps,
    config.initialPenaltyBps,
    config.auctionDuration,
    config.auctionGracePeriod,
    config.auctionPenaltyBlocks
  ];

  writeDeployedContract(config.chainId, "MatchingEngineImplementation", deployment.address, constructorArgs);

  return deployment;
}

export async function getOnChainMachingEngineConfiguration(chain: ChainInfo) {
  const config = await getMachingEngineConfiguration(chain);
  const matchingEngineProxyAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEngine = (await getContractInstance("MatchingEngine", matchingEngineProxyAddress, chain)) as MatchingEngine;

  // Get the allowance for the token messenger
  const tokenMessengerAddress = getDependencyAddress("tokenMessenger", chain.chainId);
  const tokenAddress = await matchingEngine.token();
  const token = (await getContractInstance("ERC20", tokenAddress, chain)) as ERC20;
  const cctpAllowance = (await token.allowance(matchingEngineProxyAddress, tokenMessengerAddress)).toString();

  const feeRecipient = await matchingEngine.feeRecipient();
  const ownerAssistant = await matchingEngine.getOwnerAssistant();

  const routerEndpoints = await Promise.all(config
    .routerEndpoints
    .map(async ({ wormholeChainId }) => {
      const { router, mintRecipient } = await matchingEngine.getRouterEndpoint(wormholeChainId);
      return { 
        wormholeChainId, 
        endpoint: {
          router,
          mintRecipient
        },
        circleDomain: await matchingEngine.getDomain(wormholeChainId)
      }
    }));

  return {
    cctpAllowance,
    feeRecipient,
    ownerAssistant,
    routerEndpoints
  };
} 

export async function getConfigurationDifferences(chain: ChainInfo) {
  const differences = {} as Record<string, any>;
  const onChainConfig = await getOnChainMachingEngineConfiguration(chain);
  const offChainConfig = await getMachingEngineConfiguration(chain);

  // Compare non-array values
  for (const key of Object.keys(onChainConfig)) {
    const offChainValue = offChainConfig[key as keyof typeof offChainConfig];
    const onChainValue = onChainConfig[key as keyof typeof onChainConfig];

    if (offChainValue === undefined) 
      throw new Error(`${key} not found in offChainConfig`);
    
    // Ignore key if it's an array
    if (Array.isArray(offChainValue)) 
      continue;

    differences[key] = {
      offChain: offChainValue,
      onChain: onChainValue
    };
  }

  differences.routerEndpoints = getRouterEndpointDifferences(onChainConfig.routerEndpoints, offChainConfig.routerEndpoints);

  return differences;
}

export function logDiff(differences: Record<string, any>, log: LoggerFn) {
  logComparision('feeRecipient', differences.feeRecipient, log);
  logComparision('cctpAllowance', differences.cctpAllowance, log);

  let routersLogged = false;
  for (const { wormholeChainId, router, mintRecipient, circleDomain } of differences.routerEndpoints) {
    if (!someoneIsDifferent([router, mintRecipient, circleDomain])) 
      continue;

    if (!routersLogged) {
      log('Router endpoints:');
      routersLogged = true;
    }
    
    log(`WormholeChainId ${wormholeChainId}:`);
    logComparision('router', router, log);
    logComparision('mintRecipient', mintRecipient, log);
    logComparision('circleDomain', circleDomain, log);
  }
}