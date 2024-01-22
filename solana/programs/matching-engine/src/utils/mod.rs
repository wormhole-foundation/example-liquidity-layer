use crate::{
    error::MatchingEngineError,
    state::{AuctionConfig, RouterEndpoint},
};
use anchor_lang::prelude::*;
use common::constants::FEE_PRECISION_MAX;
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;

pub fn verify_router_path(
    vaa: &VaaAccount<'_>,
    source_endpoint: &RouterEndpoint,
    target_endpoint: &RouterEndpoint,
    expected_target_chain: u16,
) -> Result<()> {
    let emitter = vaa.try_emitter_info()?;
    require_eq!(
        source_endpoint.chain,
        emitter.chain,
        MatchingEngineError::ErrInvalidSourceRouter
    );
    require!(
        source_endpoint.address == emitter.address,
        MatchingEngineError::ErrInvalidSourceRouter
    );
    require_eq!(
        target_endpoint.chain,
        expected_target_chain,
        MatchingEngineError::ErrInvalidTargetRouter
    );

    Ok(())
}

pub fn calculate_dynamic_penalty(
    config: &AuctionConfig,
    amount: u64,
    slots_elapsed: u64,
) -> Option<(u64, u64)> {
    let grace_period = config.auction_grace_period.into();
    let auction_penalty_slots = config.auction_penalty_slots.into();
    let user_penalty_reward_bps = config.user_penalty_reward_bps.into();
    let fee_precision = FEE_PRECISION_MAX.into();

    if slots_elapsed <= grace_period {
        return Some((0, 0));
    }

    let penalty_period = slots_elapsed - grace_period;
    if penalty_period >= auction_penalty_slots || config.initial_penalty_bps == FEE_PRECISION_MAX {
        let reward = amount
            .checked_mul(user_penalty_reward_bps)?
            .checked_div(fee_precision)?;

        Some((amount.checked_sub(reward)?, reward))
    } else {
        let base_penalty = amount
            .checked_mul(config.initial_penalty_bps.into())?
            .checked_div(fee_precision)?;
        let penalty = base_penalty.checked_add(
            (amount.checked_sub(base_penalty)?)
                .checked_mul(penalty_period)?
                .checked_div(auction_penalty_slots)?,
        )?;
        let reward = penalty
            .checked_mul(user_penalty_reward_bps)?
            .checked_div(fee_precision)?;

        Some((penalty.checked_sub(reward).unwrap(), reward))
    }
}
