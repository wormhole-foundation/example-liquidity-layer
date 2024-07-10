import { ethers } from "ethers";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { TokenRouter, TokenRouter__factory } from "../../../contract-bindings";
import { ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress, getContractInstance, getRouterEndpointDifferences, logComparision, someoneIsDifferent, getAddressType } from "../../../helpers"; 
import { ERC20 } from "../../../contract-bindings/out/ERC20";
import { UniversalAddress } from "@wormhole-foundation/sdk-definitions";

export function getTokenRouterConfiguration(chain: ChainInfo): Promise<TokenRouterConfiguration> {
  return getChainConfig<TokenRouterConfiguration>("token-router", chain.chainId);
}

export async function deployImplementation(chain: ChainInfo, signer: ethers.Signer, config: TokenRouterConfiguration, log: LoggerFn) {
  const factory = new TokenRouter__factory(signer);
  const token = getDependencyAddress("token", config.chainId);
  const wormhole = getDependencyAddress("wormhole", config.chainId);
  const tokenMessenger = getDependencyAddress("tokenMessenger", config.chainId);
  const mintRecipientAddressType = getAddressType(config.matchingEngineMintRecipient);
  const matchingEngineMintRecipient = (new UniversalAddress(config.matchingEngineMintRecipient, mintRecipientAddressType)).toString();

  let matchingEngineAddress = (getContractAddress(
    "MatchingEngineProxy", 
    chain.chainId
  ));

  const matchingEgineAdressType = getAddressType(matchingEngineAddress);
  matchingEngineAddress = (new UniversalAddress(matchingEngineAddress, matchingEgineAdressType)).toString();

  const deployment = await factory.deploy(
    token,
    wormhole,
    tokenMessenger,
    config.matchingEngineChain,
    matchingEngineAddress,
    matchingEngineMintRecipient,
    config.matchingEngineDomain,
    {} // overrides
  );

  await deployment.deployed();

  log(`TokenRouter deployed at ${deployment.address}`);

  const constructorArgs = [
    token,
    wormhole,
    tokenMessenger,
    config.matchingEngineChain,
    matchingEngineAddress,
    matchingEngineMintRecipient,
    config.matchingEngineDomain
  ];

  writeDeployedContract(config.chainId, "TokenRouterImplementation", deployment.address, constructorArgs);

  return deployment;
}

export async function getOnChainTokenRouterConfiguration(chain: ChainInfo) {
  const config = await getTokenRouterConfiguration(chain);
  const tokenRouterProxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterProxyAddress, chain)) as TokenRouter;

  // Get the allowance for the token messenger
  const tokenMessengerAddress = getDependencyAddress("tokenMessenger", chain.chainId);
  const orderTokenAddress = await tokenRouter.orderToken();
  const orderToken = (await getContractInstance("ERC20", orderTokenAddress, chain)) as ERC20;
  const cctpAllowance = await orderToken.allowance(tokenRouterProxyAddress, tokenMessengerAddress);

  const routerEndpoints = await Promise.all(config
    .routerEndpoints
    .map(async ({ wormholeChainId }) => {
      const { router, mintRecipient } = await tokenRouter.getRouterEndpoint(wormholeChainId);
      return { 
        wormholeChainId, 
        endpoint: {
          router,
          mintRecipient
        },
        circleDomain: await tokenRouter.getDomain(wormholeChainId)
      }
    }));

  const ownerAssistant = await tokenRouter.getOwnerAssistant();
  const { enabled, maxAmount, baseFee, initAuctionFee} = await tokenRouter.getFastTransferParameters();

  return {
    cctpAllowance,
    ownerAssistant,
    fastTransferParameters: {
      enabled,
      maxAmount: maxAmount.toString(),
      baseFee: baseFee.toString(),
      initAuctionFee: initAuctionFee.toString()
    },
    routerEndpoints
  };
}

function compareConfigurations(onChainConfig: Record<string, any>, offChainConfig: Record<string, any>) {
  const differences = {} as Record<string, any>;

  for (const key of Object.keys(onChainConfig)) {
    const offChainValue = offChainConfig[key as keyof typeof offChainConfig];
    const onChainValue = onChainConfig[key as keyof typeof onChainConfig];

    if (offChainValue === undefined) 
      throw new Error(`${key} not found in offChainConfig`);
    
    // Ignore key if it's an array
    if (Array.isArray(offChainValue)) 
      continue;
      
    // If the values are objects, compare them
    if (typeof offChainValue === 'object' && typeof onChainValue === 'object') {
      differences[key] = compareConfigurations(onChainValue, offChainValue);
      continue;
    }

    differences[key] = {
      offChain: offChainValue,
      onChain: onChainValue
    };
  }

  return differences;
}

export async function getConfigurationDifferences(chain: ChainInfo) {
  const onChainConfig = await getOnChainTokenRouterConfiguration(chain);
  const offChainConfig = await getTokenRouterConfiguration(chain);
  const differences = compareConfigurations(onChainConfig, offChainConfig);

  differences.routerEndpoints = getRouterEndpointDifferences(onChainConfig.routerEndpoints, offChainConfig.routerEndpoints);

  return differences;
}

export function logDiff(differences: Record<string, any>, log: LoggerFn) {
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

  const { enabled, maxAmount, baseFee, initAuctionFee } = differences.fastTransferParameters;
  if (someoneIsDifferent([enabled, maxAmount, baseFee, initAuctionFee])) {
    log('Fast transfer parameters:');
    for (const [key, value] of Object.entries(differences.fastTransferParameters)) {
      logComparision(key, value, log);
    }
  }
}