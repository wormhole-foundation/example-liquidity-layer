import fs from "fs";
import { ethers, utils } from "ethers";
import { validateSolAddress } from "./solana";
import { ChainConfig, ChainInfo, ContractsJson, Dependencies, DependenciesConfig, Ecosystem, UncheckedConstructorArgs, VerificationApiKeys } from "./interfaces";
import { getSigner } from "./evm";
// TODO: support different env files
import 'dotenv/config';
import { ChainId, Token, contracts as connectDependencies, toChain } from "@wormhole-foundation/sdk-base";
import { getTokensBySymbol } from "@wormhole-foundation/sdk-base/tokens";
import { MatchingEngineConfiguration } from "../config/config-types";
import { AuctionParameters } from "../../solana/ts/src/matchingEngine/state/AuctionConfig";
import { BN } from "@coral-xyz/anchor";

export const env = getEnv("ENV");
export const contracts = loadContracts();
export const dependencies = loadDependencies();
export const ecosystemChains = loadEcosystem();
export const verificationApiKeys = loadVerificationApiKeys();
export const matchingEngineParameters = loadMatchingEngineParameters();

function loadJson<T>(filename: string): T {
  const fileContent = fs.readFileSync(
    `./config/${env}/${filename}.json`
  );
  
  return JSON.parse(fileContent.toString()) as T;
}

function loadDependencies(): DependenciesConfig[] {
  return loadJson<DependenciesConfig[]>("dependencies");
}

function loadContracts<T extends ContractsJson>() {
  return loadJson<T>("contracts");
}

function loadEcosystem(): Ecosystem {
  return loadJson<Ecosystem>("ecosystem");
}

function loadVerificationApiKeys() {
  return loadJson<VerificationApiKeys[]>("verification-api-keys");
}

function loadMatchingEngineParameters(): MatchingEngineConfiguration[] { 
  return loadJson<MatchingEngineConfiguration[]>("matching-engine");
}

export function getEnv(env: string): string {
  const v = process.env[env];
  if (!v) {
    throw Error(`Env var not set: ${env}`);
  }
  return v;
}

export function getChainInfo(chainId: ChainId): ChainInfo {
  if (ecosystemChains.solana.networks.length > 1) {
    throw Error("Unexpected number of Solana networks.");
  }

  const chains = [
    ...ecosystemChains.evm.networks,
    ...ecosystemChains.solana.networks,
  ];

  const chain = chains.find((c) => c.chainId === chainId);
  if (chain === undefined) {
    throw Error(`Failed to find chain info for chain id: ${chainId}`);
  }

  return chain;
}

export async function getChainConfig<T extends ChainConfig>(filename: string, whChainId: ChainId): Promise<T> {
  const scriptConfig: T[] = await loadJson(filename);

  const chainConfig = scriptConfig.find((x) => x.chainId == whChainId);

  if (!chainConfig) {
    throw Error(`Failed to find chain config for chain ${whChainId}`);
  }

  return chainConfig;
}

export function getContractAddress(contractName: string, whChainId: ChainId): string {
  const contract = contracts[contractName]?.find((c) => c.chainId === whChainId)?.address;

  if (!contract) {
    throw new Error(`No ${contractName} contract found for chain ${whChainId}`);
  }

  if (!utils.isAddress(contract) && !validateSolAddress(contract)){
    throw new Error(`Invalid address for ${contractName} contract found for chain ${whChainId}`);
  }

  return contract;
  
}
export function getLocalDependencyAddress(dependencyName: string, chain: ChainInfo): string {
  const chainDependencies = dependencies.find((d) => d.chainId === chain.chainId);

  if (chainDependencies === undefined ) {
    throw new Error(`No dependencies found for chain ${chain.chainId}`);
  }

  const dependency = chainDependencies[dependencyName as keyof Dependencies] as string;
  if (dependency === undefined) {
    throw new Error(`No dependency found for ${dependencyName} for chain ${chain.chainId}`);
  }

  return dependency;
}

export function getDependencyAddress(dependencyName: keyof Dependencies, chain: ChainInfo): string {
  const {
    coreBridge,
    circleContracts
  } = connectDependencies;

  const symbol = "USDC";
  const nativeUSDC = (t: Token) => t.symbol === symbol && t.original === undefined
  const token = getTokensBySymbol(chain.network, toChain(chain.chainId), symbol)?.find(nativeUSDC)?.address;

  const dependencies = {
    wormhole: coreBridge.get(chain.network, toChain(chain.chainId)),
    tokenMessenger: circleContracts.get(chain.network, toChain(chain.chainId))?.tokenMessenger,
    token
  } as Dependencies;
  const connectDependency = dependencies[dependencyName as keyof Dependencies];
  
  try {
    const localDependency = getLocalDependencyAddress(dependencyName, chain);
    return localDependency === connectDependency ? connectDependency : localDependency;
  } catch (e) {
    if (connectDependency === undefined) {
      throw new Error(`No dependency found for ${dependencyName} for chain ${chain.chainId} on connect sdk`);
    }

    return connectDependency;
  }
}

export async function getContractInstance(
  contractName: string,
  contractAddress: string,
  chain: ChainInfo,
): Promise<ethers.BaseContract> {
  const factory = require("../contract-bindings")[`${contractName}__factory`];
  const signer = await getSigner(chain);
  return factory.connect(contractAddress, signer);
}

export function getDeploymentArgs(contractName: string, whChainId: ChainId): UncheckedConstructorArgs {
  const constructorArgs = contracts[contractName]?.find((c) => c.chainId === whChainId)?.constructorArgs;

  if (!constructorArgs) {
    throw new Error(`No constructorArgs found for ${contractName} contract for chain ${whChainId}`);
  }

  return constructorArgs;
}

export function getMatchingEngineAuctionParameters(chain: ChainInfo): AuctionParameters {
  const engineParameters = matchingEngineParameters.find((x) => x.chainId === chain.chainId);
  if (engineParameters === undefined) {
    throw Error(`Failed to find matching engine parameters for chain ${chain.chainId}`);
  }

  return { 
    userPenaltyRewardBps: Number(engineParameters.userPenaltyRewardBps),
    initialPenaltyBps: Number(engineParameters.initialPenaltyBps),
    duration: Number(engineParameters.auctionDuration),
    gracePeriod: Number(engineParameters.auctionGracePeriod),
    penaltyPeriod: Number(engineParameters.auctionPenaltySlots),
    minOfferDeltaBps: Number(engineParameters.minOfferDeltaBps),
    securityDepositBase: new BN(engineParameters.securityDepositBase),
    securityDepositBps: Number(engineParameters.securityDepositBps)
  }
}

export function writeDeployedContract(whChainId: ChainId, contractName: string, address: string, constructorArgs: UncheckedConstructorArgs ) {
  const contracts = loadContracts();
  if (!contracts[contractName]) {
    contracts[contractName] = [{ chainId: whChainId, address, constructorArgs }];
  }

  else if (!contracts[contractName].find((c) => c.chainId === whChainId)) {
    contracts[contractName].push({ chainId: whChainId, address, constructorArgs });
  }

  else {
    contracts[contractName] = contracts[contractName].map((c) => {
      if (c.chainId === whChainId) {
        return { chainId: whChainId, address, constructorArgs };
      }

      return c;
    });
  }
  
  fs.writeFileSync(
    `./config/${env}/contracts.json`,
    JSON.stringify(contracts),
    { flag: "w" }
  );
}