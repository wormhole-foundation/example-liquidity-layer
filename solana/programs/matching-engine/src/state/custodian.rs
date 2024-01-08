use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct AuctionConfig {
    // The percentage of the penalty that is awarded to the user when the auction is completed.
    pub user_penalty_reward_bps: u32,

    // The initial penalty percentage that is incurred once the grace period is over.
    pub initial_penalty_bps: u32,

    // The duration of the auction in blocks. About 500ms on Solana.
    pub auction_duration: u16,

    /**
     * The grace period of the auction in blocks. This is the number of blocks the highest bidder
     * has to execute the fast order before incurring a penalty. About 15 seconds on Avalanche.
     * This value INCLUDES the `_auctionDuration`.
     */
    pub auction_grace_period: u16,

    // The `securityDeposit` decays over the `penaltyBlocks` blocks period.
    pub auction_penalty_blocks: u16,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    pub bump: u8,

    /// Program's owner.
    pub owner: Pubkey,
    pub pending_owner: Option<Pubkey>,

    /// Program's assistant.
    pub owner_assistant: Pubkey,

    // Recipient of `SlowOrderResponse` relay fees.
    pub fee_recipient: Pubkey,

    /// Auction config.
    pub auction_config: AuctionConfig,
}

impl Custodian {
    pub const SEED_PREFIX: &'static [u8] = b"custodian";

    pub fn is_authorized(&self, key: &Pubkey) -> bool {
        self.owner == *key || self.owner_assistant == *key
    }
}
