import { ethers } from "ethers";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { TokenRouter, TokenRouter__factory } from "../../../contract-bindings";
import { ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress, getContractInstance, logComparision, someoneIsDifferent } from "../../../helpers"; 
import { ERC20 } from "../../../contract-bindings/out/ERC20";
import { UniversalAddress } from "@wormhole-foundation/sdk-definitions";

export function getTokenRouterConfiguration(chain: ChainInfo): Promise<TokenRouterConfiguration> {
  return getChainConfig<TokenRouterConfiguration>("token-router", chain.chainId);
}

// TODO
function getMintRecipientAddress() {
  return '6y7V8dL673XFzm9QyC5vvh3itWkp7wztahBd2yDqsyrK'
};

export async function deployImplementation(chain: ChainInfo, signer: ethers.Signer, config: TokenRouterConfiguration, log: LoggerFn) {
  const factory = new TokenRouter__factory(signer);
  const token = getDependencyAddress("token", config.chainId);
  const wormhole = getDependencyAddress("wormhole", config.chainId);
  const tokenMessenger = getDependencyAddress("tokenMessenger", config.chainId);
  
  const matchingEngineMintRecipient = (new UniversalAddress(getMintRecipientAddress(), 'base58')).toString();
  const matchinEngineChain = 1; // Solana wormhole chain id
  const matchingEngineDomain = 5; // Solana cctp domain
  let matchingEngineAddress = (getContractAddress(
    "MatchingEngineProxy", 
    matchinEngineChain
  ));
  matchingEngineAddress = (new UniversalAddress(matchingEngineAddress, 'base58')).toString();

  const deployment = await factory.deploy(
    token,
    wormhole,
    tokenMessenger,
    matchinEngineChain,
    matchingEngineAddress,
    matchingEngineMintRecipient,
    matchingEngineDomain,
    {} // overrides
  );

  await deployment.deployed();

  log(`TokenRouter deployed at ${deployment.address}`);

  const constructorArgs = [
    token,
    wormhole,
    tokenMessenger,
    matchinEngineChain,
    matchingEngineAddress,
    matchingEngineMintRecipient,
    matchingEngineDomain
  ];

  writeDeployedContract(config.chainId, "TokenRouterImplementation", deployment.address, constructorArgs);

  return deployment;
}

export async function getOnChainTokenRouterConfiguration(chain: ChainInfo) {
  const tokenRouterProxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterProxyAddress, chain)) as TokenRouter;

  // Get the allowance for the token messenger
  const tokenMessengerAddress = getDependencyAddress("tokenMessenger", chain.chainId);
  const orderTokenAddress = await tokenRouter.orderToken();
  const orderToken = (await getContractInstance("ERC20", orderTokenAddress, chain)) as ERC20;
  const cctpAllowance = await orderToken.allowance(tokenRouterProxyAddress, tokenMessengerAddress);
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
    }
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
  return compareConfigurations(onChainConfig, offChainConfig);
}

export function logDiff(differences: Record<string, any>, log: LoggerFn) {
  logComparision('cctpAllowance', differences.cctpAllowance, log);

  const { enabled, maxAmount, baseFee, initAuctionFee } = differences.fastTransferParameters;
  if (someoneIsDifferent([enabled, maxAmount, baseFee, initAuctionFee])) {
    log('Fast transfer parameters:');
    for (const [key, value] of Object.entries(differences.fastTransferParameters)) {
      logComparision(key, value, log);
    }
  }
}