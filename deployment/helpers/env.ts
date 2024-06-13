import fs from "fs";
import { ChainId } from "@certusone/wormhole-sdk";
import { ethers, utils } from "ethers";
import { validateSolAddress } from "./solana";
import { ChainConfig, ChainInfo, ContractsJson, DependenciesJson, Ecosystem } from "./interfaces";
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

function loadDependencies(): DependenciesJson {
  return loadJson<DependenciesJson>("dependencies");
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

export async function getChainConfig<T extends ChainConfig>(filename: string, chainId: ChainId): Promise<T> {
  const scriptConfig: T[] = await loadJson(filename);

  const chainConfig = scriptConfig.find((x) => x.chainId == chainId);

  if (!chainConfig) {
    throw Error(`Failed to find chain config for chain ${chainId}`);
  }

  return chainConfig;
}

export async function getContractAddress(contractName: string, chainId: ChainId): Promise<string> {
  const contract = contracts[contractName]?.find((c) => c.chainId === chainId)?.address;

  if (!contract) {
    throw new Error(`No ${contractName} contract found for chain ${chainId}`);
  }

  if (!utils.isAddress(contract) && !validateSolAddress(contract)){
    throw new Error(`Invalid address for ${contractName} contract found for chain ${chainId}`);
  }

  return contract;
}

export function getDependencyAddress(dependencyName: string, chainId: ChainId): string {
  // @ts-ignore
  const dependency = dependencies.find((d) => d.chainId === chainId)[dependencyName];

  if (!dependency) {
    throw new Error(`No dependency found for ${dependencyName}`);
  }

  if (!utils.isAddress(dependency) && !validateSolAddress(dependency)){
    throw new Error(`Invalid address for ${dependencyName} dependency found for chain ${chainId}`);
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

export function writeDeployedContract(chain: ChainId, contractName: string, address: string) {
  const contracts = loadContracts();
  if (!contracts[contractName]) {
    contracts[contractName] = [{ chainId: chain, address }];
  }

  else if (!contracts[contractName].find((c) => c.chainId === chain)) {
    contracts[contractName].push({ chainId: chain, address });
  }

  else {
    contracts[contractName] = contracts[contractName].map((c) => {
      if (c.chainId === chain) {
        return { chainId: chain, address };
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