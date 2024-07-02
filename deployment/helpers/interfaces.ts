import { ethers } from "ethers";

export type EvmScriptCb = (chain: ChainInfo, signer: ethers.Signer, logFn: LoggerFn) => Promise<void>;

export type LoggerFn = (...args: any[]) => void;

export type ChainInfo = {
  name: string;
  chainId: number; // EVM ChainId
  rpc: string;
  type: "Mainnet" | "Testnet" | "Devnet";
  externalId?: string;
};

export type Deployment = {
  chainId: number; // EVM ChainId
  address: string;
  constructorArgs?: any[];
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
  chainId: number; // EVM ChainId
}

export interface Dependencies extends ChainConfig {
    wormhole: string;
    token: string;
    tokenMessenger: string;
};

export interface ValueDiff {
  onChain: any;
  offChain: any;
}