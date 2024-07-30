import { BigNumber, ethers } from "ethers";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { TokenRouter, TokenRouter__factory, IERC20 } from "../../../contract-bindings";
import { ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress, getContractInstance, logComparison, someoneIsDifferent, ValueDiff, BigNumberDiff, StringDiff, BooleanDiff } from "../../../helpers";
import { UniversalAddress, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { Connection } from "@solana/web3.js";
import { getMatchingEngineProgram } from "../../../helpers/solana";

export interface TokenRouterState {
  cctpAllowance: BigNumberDiff;
  ownerAssistant: StringDiff;
  fastTransferParameters: {
    enabled: BooleanDiff;
    maxAmount: BigNumberDiff;
    baseFee: BigNumberDiff;
    initAuctionFee: BigNumberDiff;
  };
}

/**
 * Chain ID for the Solana wormhole chain
 */
export const matchingEngineChain = 1; 

/**
 * CCTP Domain for Solana 
 */
export const matchingEngineDomain = 5;

export function getMatchingEngineMintRecipientAddress(connection: Connection) {
  const matchingEngine = getMatchingEngineProgram(connection);
  return matchingEngine.cctpMintRecipientAddress().toBytes();
};

export function getTokenRouterConfiguration(chain: ChainInfo): Promise<TokenRouterConfiguration> {
  return getChainConfig<TokenRouterConfiguration>("token-router", chain.chainId);
}

export async function deployImplementation(chain: ChainInfo, signer: ethers.Signer, config: TokenRouterConfiguration, matchingEngineMintRecipient: UniversalAddress, log: LoggerFn) {
  if (config.chainId !== chain.chainId) {
    throw new Error(`Chain ID mismatch: ${config.chainId} !== ${chain.chainId}`);
  }
  
  const factory = new TokenRouter__factory(signer);
  const token = getDependencyAddress("token", chain);
  const wormhole = getDependencyAddress("wormhole", chain);
  const tokenMessenger = getDependencyAddress("tokenMessenger", chain);
  
  const matchingEngineAddress = toUniversal("Solana", (getContractAddress(
    "MatchingEngineProxy",
    matchingEngineChain
  ))).toString();

  const constructorArgs = [
    token,
    wormhole,
    tokenMessenger,
    matchingEngineChain,
    matchingEngineAddress,
    matchingEngineMintRecipient.toString(),
    matchingEngineDomain,
  ] as const;
  const overrides = {};

  const deployment = await factory.deploy(
    ...constructorArgs,
    overrides,
  );

  await deployment.deployed();

  log(`TokenRouter deployed at ${deployment.address}`);


  writeDeployedContract(config.chainId, "TokenRouterImplementation", deployment.address, constructorArgs);

  return deployment;
}

export async function getOnChainTokenRouterConfiguration(chain: ChainInfo) {
  const tokenRouterProxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterProxyAddress, chain)) as TokenRouter;

  // Get the allowance for the token messenger
  const tokenMessengerAddress = getDependencyAddress("tokenMessenger", chain);
  const orderTokenAddress = await tokenRouter.orderToken();
  const orderToken = (await getContractInstance("IERC20", orderTokenAddress, chain)) as IERC20;
  const cctpAllowance = await orderToken.allowance(tokenRouterProxyAddress, tokenMessengerAddress);
  const ownerAssistant = await tokenRouter.getOwnerAssistant();
  const { enabled, maxAmount, baseFee, initAuctionFee} = await tokenRouter.getFastTransferParameters();

  return {
    cctpAllowance,
    ownerAssistant,
    fastTransferParameters: {
      enabled,
      maxAmount,
      baseFee,
      initAuctionFee
    }
  };
}

function compareConfigurations(onChainConfig: Record<string, any>, offChainConfig: Record<string, any>) {
  const differences = {} as Record<string, ValueDiff>;

  for (const key of Object.keys(onChainConfig)) {
    const offChainValue = offChainConfig[key as keyof typeof offChainConfig];
    const onChainValue = onChainConfig[key as keyof typeof onChainConfig];

    if (offChainValue === undefined) 
      throw new Error(`${key} not found in offChainConfig`);
    
    // Ignore key if it's an array
    if (Array.isArray(offChainValue)) 
      continue;

    // If the values are objects, compare them
    if (!BigNumber.isBigNumber(offChainValue) && typeof offChainValue === 'object' && typeof onChainValue === 'object') {
      differences[key] = compareConfigurations(onChainValue, offChainValue) as unknown as ValueDiff;
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
  const offChainDesiredState = {
    cctpAllowance: BigNumber.from(offChainConfig.cctpAllowance),
    ownerAssistant: offChainConfig.ownerAssistant,
    fastTransferParameters: {
      enabled: offChainConfig.fastTransferParameters.enabled,
      maxAmount: BigNumber.from(offChainConfig.fastTransferParameters.maxAmount),
      baseFee: BigNumber.from(offChainConfig.fastTransferParameters.baseFee),
      initAuctionFee: BigNumber.from(offChainConfig.fastTransferParameters.initAuctionFee),
    },
  } satisfies typeof onChainConfig;
  return compareConfigurations(onChainConfig, offChainDesiredState) as unknown as TokenRouterState;
}

export function logDiff(differences: TokenRouterState, log: LoggerFn) {
  logComparison('cctpAllowance', differences.cctpAllowance, log);

  const { enabled, maxAmount, baseFee, initAuctionFee } = differences.fastTransferParameters;
  if (someoneIsDifferent([enabled, maxAmount, baseFee, initAuctionFee])) {
    log('Fast transfer parameters:');
    for (const [key, value] of Object.entries(differences.fastTransferParameters)) {
      logComparison(key, value, log);
    }
  }
}