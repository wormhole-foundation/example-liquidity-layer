import { ChainId } from "@certusone/wormhole-sdk";

export type TokenRouterConfiguration = {
  chainId: ChainId;
  ownerAssistant: string;
  matchingEngineMintRecipient: string;
  matchingEngineChain: string;
  matchingEngineDomain: string;
};

export type MatchingEngineConfiguration = {
  chainId: ChainId,
  ownerAssistant: string,
  feeRecipient: string,
  userPenaltyRewardBps: string,
  initialPenaltyBps: string,
  auctionDuration: string,
  auctionGracePeriod: string,
  auctionPenaltyBlocks: string
};