import fs from "fs";
import { ChainId } from "@certusone/wormhole-sdk";

export type ChainInfo = {
  name: string;
  chainId: ChainId;
  rpc: string;
  externalId?: string;
};

export type Deployment = {
  chainId: ChainId;
  address: string;
};

export type Ecosystem = {
  guardianSetIndex: number;
  evm: {
    operatingChains?: number[];
    networks: ChainInfo[];
  },
  solana: {
    networks: ChainInfo[];
  }
};

export type ContractsJson = Record<string, Deployment[]>;

export interface ChainConfig {
  chainId: ChainId;
}

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

function loadDependencies<T extends ContractsJson>() {
  return loadJson<T>("dependencies");
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

  return contract;
}

export function getDependencyAddress(dependencyName: string, chainId: ChainId): string {
  const dependency = dependencies[dependencyName]?.find((d) => d.chainId === chainId)?.address;

  if (!dependency) {
    throw new Error(`No dependency found for ${dependencyName}`);
  }

  return dependency;
}

export function writeDeployedContract(chain: ChainId, contractName: string, address: string) {
  const contracts = loadContracts();
  if (!contracts[contractName]) {
    contracts[contractName] = [{ chainId: chain, address: process.env[contractName]! }];
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
