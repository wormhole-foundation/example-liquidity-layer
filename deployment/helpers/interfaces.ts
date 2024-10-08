import { Commitment } from "@solana/web3.js";
import { ChainId, Network } from "@wormhole-foundation/sdk-base";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { BigNumber, BytesLike, ethers } from "ethers";

export type EvmScriptCb = (chain: ChainInfo, signer: ethers.Signer, logFn: LoggerFn) => Promise<void>;
export type SolanaScriptCb = (chain: ChainInfo, signer: SolanaLedgerSigner, logFn: LoggerFn) => Promise<void>;

export type LoggerFn = (...args: any[]) => void;

export type ChainInfo = {
  name: string;
  /**
   * Wormhole ChainId
   */
  chainId: ChainId;
  rpc: string;
  /**
   * Native (e.g. EIP-155) ChainId
   */
  externalId?: string;
  network: Network;
  commitmentLevel?: Commitment;
};

export type Deployment = {
  /**
   * Wormhole ChainId
   */
  chainId: number;
  address: string;
  constructorArgs?: UncheckedConstructorArgs;
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
  /**
   * Wormhole ChainId
   */
  chainId: ChainId;
}

export interface Dependencies {
    wormhole: string;
    token: string;
    tokenMessenger: string;
};

export interface DependenciesConfig extends ChainConfig, Dependencies {};

export interface ValueDiff<T = any> {
  onChain: T;
  offChain: T;
}

export type BooleanDiff = ValueDiff<boolean>;
export type BigNumberDiff = ValueDiff<BigNumber>;
export type StringDiff = ValueDiff<string>;

export interface VerificationApiKeys extends ChainConfig {
  etherscan: string;
  blockscout?: {
    mainnet: string;
    testnet: string;
  };
  sourcify?: string;
} 

export type RouterEndpoint = {
  /**
   * Wormhole ChainId
   */
  chainId: ChainId;
  endpoint: {
    router: BytesLike;
    mintRecipient: BytesLike;
  },
  circleDomain: number;
}

export type UncheckedConstructorArgs = readonly any[];