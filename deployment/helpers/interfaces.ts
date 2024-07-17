import { ChainId } from "@wormhole-foundation/sdk-base";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { BytesLike, ethers } from "ethers";

export type EvmScriptCb = (chain: ChainInfo, signer: ethers.Signer, logFn: LoggerFn) => Promise<void>;
export type SolanaScriptCb = (chain: ChainInfo, signer: SolanaLedgerSigner, logFn: LoggerFn) => Promise<void>;

export type LoggerFn = (...args: any[]) => void;

export type ChainInfo = {
  name: string;
  chainId: ChainId; // Wormhole ChainId
  rpc: string;
  externalId?: string; // Native ChainId
};

export type Deployment = {
  chainId: number; // Wormhole ChainId
  address: string;
  constructorArgs?: any[];
};

export type Ecosystem = {
  operatingChains?: number[];
  evm: {
    networks: ChainInfo[];
  },
  solana: {
    networks: ChainInfo[];
  }
};

export type ContractsJson = Record<string, Deployment[]>;

export interface ChainConfig {
  chainId: ChainId; // Wormhole ChainId
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

export interface VerificationApiKeys extends ChainConfig {
  etherscan: string;
  blockscout?: {
    mainnet: string;
    testnet: string;
  };
  sourcify?: string;
} 

export type RouterEndpoint = {
  wormholeChainId: ChainId;
  endpoint: {
    router: BytesLike;
    mintRecipient: BytesLike;
  },
  circleDomain: number;
}