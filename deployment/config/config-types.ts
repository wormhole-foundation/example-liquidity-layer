import { ChainId } from "@wormhole-foundation/sdk-base";

export type TokenRouterConfiguration = {
  // Wormhole Chain ID of the token router configuration
  chainId: ChainId;
  
  // Mutable values
  ownerAssistant: string;
  fastTransferParameters: {
    enabled: boolean;
    maxAmount: number;
    baseFee: number;
    initAuctionFee: number;
  };
  cctpAllowance: number;
  disableRouterEndpoints?: ChainId[];
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
  cctpAllowance: number;
};