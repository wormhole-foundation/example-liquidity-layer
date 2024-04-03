use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq)]
pub struct AuctionParameters {
    // The percentage of the penalty that is awarded to the user when the auction is completed.
    pub user_penalty_reward_bps: u32,

    // The initial penalty percentage that is incurred once the grace period is over.
    pub initial_penalty_bps: u32,

    // The duration of the auction in slots. About 500ms on Solana.
    pub duration: u16,

    /**
     * The grace period of the auction in slots. This is the number of slots the highest bidder
     * has to execute the fast order before incurring a penalty. About 15 seconds on Avalanche.
     * This value INCLUDES the `_auctionDuration`.
     */
    pub grace_period: u16,

    // The `securityDeposit` decays over the `penalty_slots` slots period.
    pub penalty_period: u16,

    // The minimum offer increment in percentage terms.
    pub min_offer_delta_bps: u32,

    /// The base security deposit, which will the the additional amount an auction participant must
    /// deposit to participate in an auction.
    pub security_deposit_base: u64,

    /// Additional security deposit based on the notional of the order amount.
    pub security_deposit_bps: u32,
}

#[account]
#[derive(Debug, InitSpace, Copy)]
pub struct AuctionConfig {
    /// Monotonically increasing identifier for auction configs.
    pub id: u32,
    /// Auction parameters, which are validated by [crate::utils::auction::require_valid_parameters].
    pub parameters: AuctionParameters,
}

impl AuctionConfig {
    pub const SEED_PREFIX: &'static [u8] = b"auction-config";
}

impl std::ops::Deref for AuctionConfig {
    type Target = AuctionParameters;

    fn deref(&self) -> &Self::Target {
        &self.parameters
    }
}
