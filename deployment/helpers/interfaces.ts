import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export type EvmScriptCb = (chain: ChainInfo, signer: ethers.Signer, logFn: LoggerFn) => Promise<void>;

export type LoggerFn = (...args: any[]) => void;

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

export type DependenciesJson = [
  {
    chainId: ChainId;
    wormhole: string;
    token: string;
    tokenMessenger: string;
  }
];