import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { TokenRouter, TokenRouter__factory } from "../../../contract-bindings";
import { ChainInfo, getChainConfig, LoggerFn, getDependencyAddress, writeDeployedContract, getContractAddress, ETHEREUM_ADDRESS_LENGTH, getContractInstance } from "../../../helpers"; 
import bs58 from 'bs58';

export function getTokenRouterConfiguration(chain: ChainInfo): Promise<TokenRouterConfiguration> {
  return getChainConfig<TokenRouterConfiguration>("token-router", chain.chainId);
}

export async function deployImplementation(signer: ethers.Signer, config: TokenRouterConfiguration, log: LoggerFn) {
  const factory = new TokenRouter__factory(signer);

  const token = getDependencyAddress("token", config.chainId);
  const wormhole = getDependencyAddress("wormhole", config.chainId);
  const tokenMessenger = getDependencyAddress("tokenMessenger", config.chainId);
  const matchingEngineMintRecipient = getAddressAsBytes32(config.matchingEngineMintRecipient);

  let matchingEngineAddress = await getContractAddress(
    "MatchingEngineProxy", 
    Number(config.matchingEngineChain) as ChainId
  );
  matchingEngineAddress = getAddressAsBytes32(matchingEngineAddress);

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

  writeDeployedContract(config.chainId, "TokenRouterImplementation", deployment.address);

  return deployment;
}

export async function getOnChainTokenRouterConfiguration(chain: ChainInfo) {
  const config = await getTokenRouterConfiguration(chain);
  const tokenRouterAddress = await getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouterImplementation", tokenRouterAddress, chain)) as TokenRouter;

  // instantiate erc20 token and get the allowance for the token messenger?
  const cctpAllowance = await tokenRouter.cctpAllowance();

  const routerEndpoints = await Promise.all(config
    .routerEndpoints
    .map(async ({ chainId }) => ({ chainId, endpoint: await tokenRouter.getRouterEndpoint(chainId)})));



  return {
    cctpAllowance,
    routerEndpoints
  };
}

export function getAddressAsBytes32(address: string): string {
  const addressLength = address.length - (address.startsWith("0x") ? 2 : 0);

  // Solana address
  if (addressLength > ETHEREUM_ADDRESS_LENGTH) { 
    const bytes = bs58.decode(address);
    address = "0x" + Buffer.from(bytes).toString('hex');
  } 
  // Ethereum address
  else { 
    address = ethers.utils.defaultAbiCoder.encode(["address"], [address]);
  }

  return address;
}