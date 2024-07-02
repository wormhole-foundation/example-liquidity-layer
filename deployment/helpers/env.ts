import fs from "fs";
import { ethers, utils } from "ethers";
import { validateSolAddress } from "./solana";
import { ChainConfig, ChainInfo, ContractsJson, Dependencies, Ecosystem } from "./interfaces";
import { getSigner } from "./evm";
// TODO: support different env files
import 'dotenv/config';

export const env = getEnv("ENV");
export const contracts = loadContracts();
export const dependencies = loadDependencies();
export const ecosystemChains = loadEcosystem();

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

export function getEnv(env: string): string {
  const v = process.env[env];
  if (!v) {
    throw Error(`Env var not set: ${env}`);
  }
  return v;
}

export async function getChainConfig<T extends ChainConfig>(filename: string, evmChainId: number): Promise<T> {
  const scriptConfig: T[] = await loadJson(filename);

  const chainConfig = scriptConfig.find((x) => x.chainId == evmChainId);

  if (!chainConfig) {
    throw Error(`Failed to find chain config for chain ${evmChainId}`);
  }

  return chainConfig;
}

export function getContractAddress(contractName: string, evmChainId: number): string {
  const contract = contracts[contractName]?.find((c) => c.chainId === evmChainId)?.address;

  if (!contract) {
    throw new Error(`No ${contractName} contract found for chain ${evmChainId}`);
  }

  if (!utils.isAddress(contract) && !validateSolAddress(contract)){
    throw new Error(`Invalid address for ${contractName} contract found for chain ${evmChainId}`);
  }

  return contract;
}

export function getDependencyAddress(dependencyName: string, evmChainId: number): string {
  const chainDependencies = dependencies.find((d) => d.chainId === evmChainId);

  if (chainDependencies === undefined ) {
    throw new Error(`No dependencies found for chain ${evmChainId}`);
  }

  const dependency = chainDependencies[dependencyName as keyof Dependencies] as string;
  if (dependency === undefined) {
    throw new Error(`No dependency found for ${dependencyName} for chain ${evmChainId}`);
  }

  if (!utils.isAddress(dependency) && !validateSolAddress(dependency)){
    throw new Error(`Invalid address for ${dependencyName} dependency found for chain ${evmChainId}`);
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

export function getDeploymentArgs(contractName: string, evmChainId: number): any[] {
  const constructorArgs = contracts[contractName]?.find((c) => c.chainId === evmChainId)?.constructorArgs;

  if (!constructorArgs) {
    throw new Error(`No constructorArgs found for ${contractName} contract for chain ${evmChainId}`);
  }

  return constructorArgs;
}

export function writeDeployedContract(evmChainId: number, contractName: string, address: string, constructorArgs: any[] ) {
  const contracts = loadContracts();
  if (!contracts[contractName]) {
    contracts[contractName] = [{ chainId: evmChainId, address, constructorArgs }];
  }

  else if (!contracts[contractName].find((c) => c.chainId === evmChainId)) {
    contracts[contractName].push({ chainId: evmChainId, address, constructorArgs });
  }

  else {
    contracts[contractName] = contracts[contractName].map((c) => {
      if (c.chainId === evmChainId) {
        return { chainId: evmChainId, address, constructorArgs };
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