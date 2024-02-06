use crate::{
    error::MatchingEngineError,
    state::{AuctionInfo, AuctionParameters},
};
use anchor_lang::prelude::*;
use common::constants::FEE_PRECISION_MAX;

#[derive(Debug, Default)]
pub struct DepositPenalty {
    pub penalty: u64,
    pub user_reward: u64,
}

#[inline]
pub fn compute_deposit_penalty(
    params: &AuctionParameters,
    info: &AuctionInfo,
    current_slot: u64,
) -> DepositPenalty {
    let slots_elapsed = current_slot.saturating_sub(info.start_slot + params.duration as u64);

    if slots_elapsed <= params.grace_period as u64 {
        Default::default()
    } else {
        let deposit = info.security_deposit;
        let penalty_period = slots_elapsed - params.grace_period as u64;
        if penalty_period >= params.penalty_slots as u64
            || params.initial_penalty_bps == FEE_PRECISION_MAX
        {
            split_user_penalty_reward(params, deposit)
        } else {
            let base_penalty = mul_bps_unsafe(deposit, params.initial_penalty_bps);

            // Adjust the base amount to determine scaled penalty.
            let scaled = (((deposit - base_penalty) as u128 * penalty_period as u128)
                / params.penalty_slots as u128) as u64;

            split_user_penalty_reward(params, base_penalty + scaled)
        }
    }
}

pub fn require_valid_parameters(params: &AuctionParameters) -> Result<()> {
    require!(
        params.duration > 0,
        MatchingEngineError::InvalidAuctionDuration
    );
    require!(
        params.grace_period > 0,
        MatchingEngineError::InvalidAuctionGracePeriod
    );
    require!(
        params.user_penalty_reward_bps <= FEE_PRECISION_MAX,
        MatchingEngineError::UserPenaltyTooLarge
    );
    require!(
        params.initial_penalty_bps <= FEE_PRECISION_MAX,
        MatchingEngineError::InitialPenaltyTooLarge
    );

    Ok(())
}

#[inline]
fn split_user_penalty_reward(params: &AuctionParameters, amount: u64) -> DepositPenalty {
    let user_reward = mul_bps_unsafe(amount, params.user_penalty_reward_bps);

    DepositPenalty {
        penalty: amount - user_reward,
        user_reward,
    }
}

#[inline]
fn mul_bps_unsafe(amount: u64, bps: u32) -> u64 {
    ((amount as u128 * bps as u128) / FEE_PRECISION_MAX as u128) as u64
}

#[cfg(test)]
mod test {
    use crate::state::AuctionParameters;

    use super::*;

    #[test]
    fn still_in_grace_period() {
        let params = params_for_test();

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period - 1;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 0);
        assert_eq!(user_reward, 0);
    }

    #[test]
    fn penalty_period_is_over() {
        let params = params_for_test();

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + params.penalty_slots;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 7500000);
        assert_eq!(user_reward, 2500000);
    }

    #[test]
    fn one_slot_into_penalty_period() {
        let params = params_for_test();

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + 1;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 1087500);
        assert_eq!(user_reward, 362500);
    }

    #[test]
    fn half_way_through_penalty_period() {
        let params = params_for_test();

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + params.penalty_slots / 2;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 4125000);
        assert_eq!(user_reward, 1375000);
    }

    #[test]
    fn mostly_through_penalty_period() {
        let params = params_for_test();

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + params.penalty_slots - 1;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 7162500);
        assert_eq!(user_reward, 2387500);
    }

    #[test]
    fn initial_penalty_zero_halfway_through_penalty_period() {
        let params = AuctionParameters {
            initial_penalty_bps: 0,
            ..params_for_test()
        };

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + params.penalty_slots / 2;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 3750000);
        assert_eq!(user_reward, 1250000);
    }

    #[test]
    fn user_reward_zero_initial_penalty_zero() {
        let params = AuctionParameters {
            user_penalty_reward_bps: 0,
            initial_penalty_bps: 0,
            ..params_for_test()
        };

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + params.penalty_slots / 2;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 5000000);
        assert_eq!(user_reward, 0);
    }

    #[test]
    fn initial_penalty_max_user_penalty_half() {
        let params = AuctionParameters {
            user_penalty_reward_bps: common::constants::FEE_PRECISION_MAX / 2,
            initial_penalty_bps: common::constants::FEE_PRECISION_MAX,
            ..params_for_test()
        };

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + 5;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 5000000);
        assert_eq!(user_reward, 5000000);
    }

    #[test]
    fn user_penalty_max_initial_penalty_half() {
        let params = AuctionParameters {
            user_penalty_reward_bps: common::constants::FEE_PRECISION_MAX,
            initial_penalty_bps: common::constants::FEE_PRECISION_MAX / 2,
            ..params_for_test()
        };

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + params.penalty_slots / 2;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 0);
        assert_eq!(user_reward, 7500000);
    }

    #[test]
    fn penalty_slots_zero() {
        let params = AuctionParameters {
            user_penalty_reward_bps: common::constants::FEE_PRECISION_MAX / 2,
            initial_penalty_bps: common::constants::FEE_PRECISION_MAX / 2,
            penalty_slots: 0,
            ..params_for_test()
        };

        let amount = 10000000;
        let slots_elapsed = params.duration + params.grace_period + 10;
        let (info, current_slot) = set_up(amount, Some(slots_elapsed.into()));

        let DepositPenalty {
            penalty,
            user_reward,
        } = compute_deposit_penalty(&params, &info, current_slot);

        assert_eq!(penalty, 5000000);
        assert_eq!(user_reward, 5000000);
    }

    fn set_up(security_deposit: u64, slots_elapsed: Option<u64>) -> (AuctionInfo, u64) {
        const START: u64 = 69;
        (
            AuctionInfo {
                security_deposit,
                start_slot: START,
                config_id: Default::default(),
                source_chain: Default::default(),
                best_offer_token: Default::default(),
                initial_offer_token: Default::default(),
                amount_in: Default::default(),
                offer_price: Default::default(),
                amount_out: Default::default(),
            },
            START + slots_elapsed.unwrap_or_default(),
        )
    }

    fn params_for_test() -> AuctionParameters {
        let params = AuctionParameters {
            user_penalty_reward_bps: 250000, // 25%
            initial_penalty_bps: 100000,     // 10%
            duration: 2,
            grace_period: 4,
            penalty_slots: 20,
        };

        require_valid_parameters(&params).unwrap();

        params
    }
}
