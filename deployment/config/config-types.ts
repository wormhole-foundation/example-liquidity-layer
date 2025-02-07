import { ChainId } from "@wormhole-foundation/sdk-base";

// TODO: check if solana has different needs for the TokenRouter
export type TokenRouterConfiguration = {
  // Wormhole Chain ID of the token router configuration
  chainId: ChainId;
  
  // Mutable values
  /**
   * Account with the authority to add
   * new token routers among other operations.
   */
  ownerAssistant: string;
  fastTransferParameters: {
    enabled: boolean;
    /**
     * Expressed in μUSDC.
     * E.g. 1000000000 is 1000 USDC.
     */
    maxAmount: string;
    /**
     * Expressed in μUSDC.
     * E.g. 1250000 is 1.25 USDC.
     */
    baseFee: string;
    /**
     * Expressed in μUSDC.
     * E.g. 950000 is 0.95 USDC.
     */
    initAuctionFee: string;
  };
  cctpAllowance: string;
  disableRouterEndpoints?: ChainId[];
};

export type MatchingEngineConfiguration = {
  /**
   * Wormhole Chain ID of the matching engine configuration
   */
  chainId: ChainId;

  // Immutable values
  /**
   * The part of the penalty that is awarded to the user when the auction is completed.
   * E.g. 400000 is 40%.
   */
  userPenaltyRewardBps: string;
  /**
   * The initial penalty proportion that is incurred once the grace period is over.
   * E.g. 250000 is 25%.
   */
  initialPenaltyBps: string;
  /**
   * Auction duration in Solana slots.
   */
  auctionDuration: string;
  /**
   * Auction grace period in Solana slots.
   * The grace period of the auction in slots. This is the number of slots the highest bidder
   * has to execute the fast order before incurring a penalty.
   * This value INCLUDES the `auctionDuration`.
   */
  auctionGracePeriod: string;
  /**
   * The `securityDeposit` decays over this period.
   * Expressed in Solana slots.
   */
  auctionPenaltySlots: string;
  /**
   * minimum offer increment for auctions.
   * New offers need to surpass a threshold given by this parameter.
   * E.g. 50000 is 5%.
   */
  minOfferDeltaBps: string;
  /**
   * The base security deposit, which will the the additional amount an auction participant must
   * deposit to participate in an auction. Expressed in μUSDC.
   * E.g. 1000000 is 1 USDC.
   */
  securityDepositBase: string;
  /**
   * Additional security deposit based on the notional of the order amount.
   * E.g. 5000 is 0.5%.
   */
  securityDepositBps: string;
  
  // Mutable values
  /**
   * Solana account with the authority to add
   * new token routers among other operations.
   */
  ownerAssistant: string;
  /**
   * Fee recipient for relayer service of slow orders, i.e. those that do not
   * have an associated auction.
   */
  feeRecipient: string;
  cctpAllowance: string;
};