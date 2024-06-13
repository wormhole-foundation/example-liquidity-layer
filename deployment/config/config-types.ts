import { ChainId } from "@certusone/wormhole-sdk";
import { BytesLike } from "ethers";

export type RouterEndpointConfig = {
  chainId: ChainId;
  endpoint: {
    router: BytesLike;
    mintRecipient: BytesLike;
  },
  circleDomain: number;
}

export type TokenRouterConfiguration = {
  // Chain ID of the token router configuration
  chainId: ChainId;
  
  // Immutable values
  matchingEngineMintRecipient: string;
  matchingEngineChain: string;
  matchingEngineDomain: string;
  
  // Mutable values
  ownerAssistant: string;
  routerEndpoints: RouterEndpointConfig[];
  fastTransferParameters: {
    enabled: boolean;
    maxAmount: number;
    baseFee: number;
    initAuctionFee: number;
  };
  cctpAllowance: number;
};

export type MatchingEngineConfiguration = {
  // Chain ID of the matching engine configuration
  chainId: ChainId;

  // Immutable values
  userPenaltyRewardBps: string;
  initialPenaltyBps: string;
  auctionDuration: string;
  auctionGracePeriod: string;
  auctionPenaltyBlocks: string;
  
  // Mutable values
  ownerAssistant: string;
  feeRecipient: string;
  routerEndpoints: RouterEndpointConfig[];
  cctpAllowance: number;
};