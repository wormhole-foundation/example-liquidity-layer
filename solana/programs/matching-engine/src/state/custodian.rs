use anchor_lang::prelude::*;
use common::constants::FEE_PRECISION_MAX;
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct AuctionConfig {
    // The percentage of the penalty that is awarded to the user when the auction is completed.
    pub user_penalty_reward_bps: u32,

    // The initial penalty percentage that is incurred once the grace period is over.
    pub initial_penalty_bps: u32,

    // The duration of the auction in slots. About 500ms on Solana.
    pub auction_duration: u16,

    /**
     * The grace period of the auction in slots. This is the number of slots the highest bidder
     * has to execute the fast order before incurring a penalty. About 15 seconds on Avalanche.
     * This value INCLUDES the `_auctionDuration`.
     */
    pub auction_grace_period: u16,

    // The `securityDeposit` decays over the `penaltyslots` slots period.
    pub auction_penalty_slots: u16,
}

/// TODO: Whitelist USDC mint key.

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    pub bump: u8,
    pub custody_token_bump: u8,

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

    pub fn calculate_dynamic_penalty(&self, amount: u64, slots_elapsed: u64) -> Option<(u64, u64)> {
        let config = &self.auction_config;
        let grace_period = u64::try_from(config.auction_grace_period).unwrap();
        let auction_penalty_slots = u64::try_from(config.auction_penalty_slots).unwrap();
        let user_penalty_reward_bps = u64::try_from(config.user_penalty_reward_bps).unwrap();
        let fee_precision = u64::try_from(FEE_PRECISION_MAX).unwrap();

        if slots_elapsed <= grace_period {
            return Some((0, 0));
        }

        let penalty_period = slots_elapsed - grace_period;
        if penalty_period >= auction_penalty_slots
            || config.initial_penalty_bps == FEE_PRECISION_MAX
        {
            let reward = amount
                .checked_mul(user_penalty_reward_bps)?
                .checked_div(fee_precision)?;

            return Some((amount.checked_sub(reward)?, reward));
        } else {
            let base_penalty = amount
                .checked_mul(u64::try_from(config.initial_penalty_bps).unwrap())?
                .checked_div(fee_precision)?;
            let penalty = base_penalty.checked_add(
                (amount.checked_sub(base_penalty)?)
                    .checked_mul(penalty_period)?
                    .checked_div(auction_penalty_slots)?,
            )?;
            let reward = amount
                .checked_mul(user_penalty_reward_bps)?
                .checked_div(fee_precision)?;

            return Some((penalty - reward, reward));
        }
    }
}

impl common::admin::Ownable for Custodian {
    fn owner(&self) -> &Pubkey {
        &self.owner
    }

    fn owner_mut(&mut self) -> &mut Pubkey {
        &mut self.owner
    }
}

impl common::admin::PendingOwner for Custodian {
    fn pending_owner(&self) -> &Option<Pubkey> {
        &self.pending_owner
    }

    fn pending_owner_mut(&mut self) -> &mut Option<Pubkey> {
        &mut self.pending_owner
    }
}

impl common::admin::OwnerAssistant for Custodian {
    fn owner_assistant(&self) -> &Pubkey {
        &self.owner_assistant
    }

    fn owner_assistant_mut(&mut self) -> &mut Pubkey {
        &mut self.owner_assistant
    }
}
