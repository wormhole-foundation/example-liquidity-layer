import fs from "fs";
import { ethers, utils } from "ethers";
import { validateSolAddress } from "./solana";
import { ChainConfig, ChainInfo, ContractsJson, Dependencies, Ecosystem, VerificationApiKeys } from "./interfaces";
import { getSigner } from "./evm";
// TODO: support different env files
import 'dotenv/config';
import { ChainId } from "@wormhole-foundation/sdk-base";

export const env = getEnv("ENV");
export const contracts = loadContracts();
export const dependencies = loadDependencies();
export const ecosystemChains = loadEcosystem();
export const verificationApiKeys = loadVerificationApiKeys();

function loadJson<T>(filename: string): T {
  const fileContent = fs.readFileSync(
    `./config/${env}/${filename}.json`
  );
  
  return JSON.parse(fileContent.toString()) as T;
}

function loadDependencies(): Dependencies[] {
  return loadJson<Dependencies[]>("dependencies");
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

export function getDependencyAddress(dependencyName: string, whChainId: ChainId): string {
  const chainDependencies = dependencies.find((d) => d.chainId === whChainId);

  if (chainDependencies === undefined ) {
    throw new Error(`No dependencies found for chain ${whChainId}`);
  }

  const dependency = chainDependencies[dependencyName as keyof Dependencies] as string;
  if (dependency === undefined) {
    throw new Error(`No dependency found for ${dependencyName} for chain ${whChainId}`);
  }

  if (!utils.isAddress(dependency) && !validateSolAddress(dependency)){
    throw new Error(`Invalid address for ${dependencyName} dependency found for chain ${whChainId}`);
  }

  return dependency;
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

export function getDeploymentArgs(contractName: string, whChainId: ChainId): any[] {
  const constructorArgs = contracts[contractName]?.find((c) => c.chainId === whChainId)?.constructorArgs;

  if (!constructorArgs) {
    throw new Error(`No constructorArgs found for ${contractName} contract for chain ${whChainId}`);
  }

  return constructorArgs;
}

export function writeDeployedContract(whChainId: ChainId, contractName: string, address: string, constructorArgs: any[] ) {
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