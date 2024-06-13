import { ethers } from "ethers";
import { MatchingEngineConfiguration, RouterEndpointConfig } from "../../../config/config-types";
import { MatchingEngine, MatchingEngine__factory } from "../../../contract-bindings";
import { ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress, getContractInstance } from "../../../helpers";
import { ERC20 } from "../../../contract-bindings/out/ERC20";
import { ChainId } from "@certusone/wormhole-sdk";

export function getMachingEngineConfiguration(chain: ChainInfo): Promise<MatchingEngineConfiguration> {
  return getChainConfig<MatchingEngineConfiguration>("matching-engine", chain.chainId);
}

export async function deployImplementation(signer: ethers.Signer, config: MatchingEngineConfiguration, log: LoggerFn) {
  const factory = new MatchingEngine__factory(signer);
  const token = getDependencyAddress("token", config.chainId);
  const wormhole = getDependencyAddress("wormhole", config.chainId);
  const tokenMessenger = getDependencyAddress("tokenMessenger", config.chainId);
  const MAX_BPS_FEE = 1000000;

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

  writeDeployedContract(config.chainId, "MatchingEngineImplementation", deployment.address);

  return deployment;
}

export async function getOnChainMachingEngineConfiguration(chain: ChainInfo) {
  const config = await getMachingEngineConfiguration(chain);
  const matchingEngineImplementationAddress = await getContractAddress("MatchingEngineImplementation", chain.chainId);
  const matchingEngineAddress = await getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEngine = (await getContractInstance("MatchingEngine", matchingEngineAddress, chain)) as MatchingEngine;

  // Get the allowance for the token messenger
  const tokenMessengerAddress = getDependencyAddress("tokenMessenger", chain.chainId);
  const tokenAddress = await matchingEngine.token();
  const token = (await getContractInstance("ERC20", tokenAddress, chain)) as ERC20;
  const decimals = await token.decimals();
  const rawCctpAllowance = await token.allowance(matchingEngineImplementationAddress, tokenMessengerAddress);
  const cctpAllowance = ethers.utils.formatUnits(rawCctpAllowance, decimals);

  const feeRecipient = await matchingEngine.feeRecipient();

  const routerEndpoints = await Promise.all(config
    .routerEndpoints
    .map(async ({ chainId }) => {
      const { router, mintRecipient } = await matchingEngine.getRouterEndpoint(chainId);
      return { 
        chainId, 
        endpoint: {
          router,
          mintRecipient
        },
        circleDomain: await matchingEngine.getDomain(chainId)
      }
    }));

  return {
    cctpAllowance,
    feeRecipient,
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

    if (!offChainValue) 
      throw new Error(`${key} not found in offChainConfig`);
    
    // Ignore key if it's an array
    if (Array.isArray(offChainValue)) 
      continue;

    const isDifferent = offChainValue.toString() !== onChainValue;
    if (isDifferent) {
      differences[key] = {
        offChain: offChainValue,
        onChain: onChainValue
      };
    }
  }

  let onChainIndex = 0;
  let offChainIndex = 0; 
  const routerEndpointsDifferences = [];
  const onChainRouterEndpoints = onChainConfig.routerEndpoints.sort((a, b) => a.chainId - b.chainId);
  const offChainRouterEndpoints = offChainConfig.routerEndpoints.sort((a, b) => a.chainId - b.chainId);
  while (true) {
    const onChainEndpoint = onChainRouterEndpoints[onChainIndex];
    const offChainEndpoint = offChainRouterEndpoints[offChainIndex];

    // If we've reached the end of both arrays, we're done
    if (!onChainEndpoint && !offChainEndpoint) {
      break;
    }

    // If we've reached the end of offChainEndpoints, add the remaining onChainEndpoints
    // or if the onChainEndpoint is less than the offChainEndpoint, add the onChainEndpoint
    if (!offChainEndpoint || onChainEndpoint?.chainId < offChainEndpoint?.chainId) {
      routerEndpointsDifferences.push(
        routerEndpointConfig(onChainEndpoint.chainId, onChainEndpoint, {})
      );
      onChainIndex++;
    } 

    // If we've reached the end of onChainEndpoints, add the remaining offChainEndpoints
    // or if the offChainEndpoint is less than the onChainEndpoint, add the offChainEndpoint
    else if (!onChainEndpoint || onChainEndpoint?.chainId > offChainEndpoint?.chainId) {
      routerEndpointsDifferences.push(
        routerEndpointConfig(offChainEndpoint.chainId, {}, offChainEndpoint)
      );
      offChainIndex++;
    } 
    
    // If the chainIds are the same, add the differences between the two endpoints
    else {
      routerEndpointsDifferences.push(
        routerEndpointConfig(onChainEndpoint.chainId, onChainEndpoint, offChainEndpoint)
      );
      onChainIndex++;
      offChainIndex++;
    }
  }

  differences.routerEndpoints = routerEndpointsDifferences;

  return differences;
}

const routerEndpointConfig = (chainId: ChainId,  onChain: Partial<RouterEndpointConfig>, offChain: Partial<RouterEndpointConfig>) => ({
  [`endpoint-chainId-${chainId}`]: {
    router: {
      onChain: onChain?.endpoint?.router,
      offChain: offChain?.endpoint?.router
    },
    mintRecipient: {
      onChain: onChain?.endpoint?.mintRecipient,
      offChain: offChain?.endpoint?.mintRecipient
    }
  },
  circleDomain: {
    onChain: onChain?.circleDomain,
    offChain: offChain?.circleDomain
  }
});