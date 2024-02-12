#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

mod processor;
pub(crate) use processor::*;

pub mod state;

use anchor_lang::prelude::*;

declare_id!(common::constants::UPGRADE_MANAGER_PROGRAM_ID);

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        const UPGRADE_AUTHORITY_BUMP: u8 = 255;
    } else if #[cfg(feature = "localnet")] {
        const UPGRADE_AUTHORITY_BUMP: u8 = 255;
    }
}

const UPGRADE_AUTHORITY_SEED_PREFIX: &[u8] = b"upgrade";
const UPGRADE_AUTHORITY_SIGNER_SEEDS: &[&[u8]] =
    &[UPGRADE_AUTHORITY_SEED_PREFIX, &[UPGRADE_AUTHORITY_BUMP]];

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn upgrade_authority() {
        let (actual_addr, actual_bump_seed) =
            Pubkey::find_program_address(&[UPGRADE_AUTHORITY_SEED_PREFIX], &crate::id());
        assert_eq!(actual_bump_seed, UPGRADE_AUTHORITY_BUMP);
        assert_eq!(actual_addr, common::constants::UPGRADE_MANAGER_AUTHORITY);
    }
}

#[program]
pub mod upgrade_manager {
    use super::*;

    // Matching Engine

    pub fn upgrade_matching_engine(ctx: Context<UpgradeMatchingEngine>) -> Result<()> {
        processor::upgrade_matching_engine(ctx)
    }

    // Token Router

    pub fn execute_token_router_upgrade(ctx: Context<ExecuteTokenRouterUpgrade>) -> Result<()> {
        processor::execute_token_router_upgrade(ctx)
    }
}
