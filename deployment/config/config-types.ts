import { ChainId } from "@wormhole-foundation/sdk-base";
import { BytesLike } from "ethers";

export type RouterEndpointConfig = {
  wormholeChainId: ChainId;
  endpoint: {
    router: BytesLike;
    mintRecipient: BytesLike;
  },
  circleDomain: number;
}

export type TokenRouterConfiguration = {
  // Wormhole Chain ID of the token router configuration
  chainId: ChainId;
  
  // Immutable values
  matchingEngineMintRecipient: string;
  matchingEngineChain: ChainId; // Wormhole Chain ID
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
  // Wormhole Chain ID of the matching engine configuration
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