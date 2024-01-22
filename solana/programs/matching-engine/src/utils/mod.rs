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

#[cfg(test)]
mod test {
    use super::*;
    use anchor_lang::prelude::Result;

    #[test]
    fn test_calculate_dynamic_penalty() -> Result<()> {
        // Create test AuctionConfig struct.
        let mut config = AuctionConfig {
            user_penalty_reward_bps: 250000,
            initial_penalty_bps: 100000,
            auction_duration: 2,
            auction_grace_period: 6,
            auction_penalty_slots: 20,
        };

        // Still in grace period.
        {
            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period - 1;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 0);
            assert_eq!(reward, 0);
        }

        // Penalty period is over.
        {
            let amount = 10000000;
            let slots_elapsed = config.auction_penalty_slots + config.auction_grace_period;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 7500000);
            assert_eq!(reward, 2500000);
        }

        // One slot into the penalty period.
        {
            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 1;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 1087500);
            assert_eq!(reward, 362500);
        }

        // 50% of the way through the penalty period.
        {
            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 10;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 4125000);
            assert_eq!(reward, 1375000);
        }

        // Penalty period (19/20 slots).
        {
            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 19;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 7162500);
            assert_eq!(reward, 2387500);
        }

        // Update the initial penalty to 0%. 50% of the way through the penalty period.
        {
            config.initial_penalty_bps = 0;

            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 10;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 3750000);
            assert_eq!(reward, 1250000);
        }

        // Set the user reward to 0%.
        {
            config.user_penalty_reward_bps = 0;

            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 10;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 5000000);
            assert_eq!(reward, 0);
        }

        // Set the initial penalty to 100% and user penalty to 50%.
        {
            config.initial_penalty_bps = FEE_PRECISION_MAX;
            config.user_penalty_reward_bps = 500000;

            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 5;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 5000000);
            assert_eq!(reward, 5000000);
        }

        // Set the user penalty to 100% and initial penalty to 50%.
        {
            config.initial_penalty_bps = 500000;
            config.user_penalty_reward_bps = FEE_PRECISION_MAX;

            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 10;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 0);
            assert_eq!(reward, 7500000);
        }

        // Set the penalty blocks to zero.
        {
            config.initial_penalty_bps = 500000;
            config.user_penalty_reward_bps = 500000;
            config.auction_penalty_slots = 0;

            let amount = 10000000;
            let slots_elapsed = config.auction_grace_period + 10;
            let (penalty, reward) =
                calculate_dynamic_penalty(&config, amount, u64::try_from(slots_elapsed).unwrap())
                    .unwrap();

            assert_eq!(penalty, 5000000);
            assert_eq!(reward, 5000000);
        }

        Ok(())
    }
}
