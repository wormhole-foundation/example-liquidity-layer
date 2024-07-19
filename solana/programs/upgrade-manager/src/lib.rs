#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

mod composite;

mod error;

mod processor;
use processor::*;

pub mod state;

mod utils;

use anchor_lang::prelude::*;

declare_id!(common::UPGRADE_MANAGER_PROGRAM_ID);

cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        const UPGRADE_AUTHORITY_BUMP: u8 = 255;
    } else if #[cfg(feature = "testnet")] {
        const UPGRADE_AUTHORITY_BUMP: u8 = 255;
    } else if #[cfg(feature = "localnet")] {
        const UPGRADE_AUTHORITY_BUMP: u8 = 255;
    }
}

const UPGRADE_AUTHORITY_SEED_PREFIX: &[u8] = b"upgrade";
const UPGRADE_AUTHORITY_SIGNER_SEEDS: &[&[u8]] =
    &[UPGRADE_AUTHORITY_SEED_PREFIX, &[UPGRADE_AUTHORITY_BUMP]];

#[program]
pub mod upgrade_manager {
    use super::*;

    // Matching Engine

    pub fn execute_matching_engine_upgrade(
        ctx: Context<ExecuteMatchingEngineUpgrade>,
    ) -> Result<()> {
        utils::execute_upgrade(ctx.accounts, &ctx.bumps.execute_upgrade)
    }

    pub fn commit_matching_engine_upgrade(ctx: Context<CommitMatchingEngineUpgrade>) -> Result<()> {
        processor::commit_matching_engine_upgrade(ctx)
    }

    // Token Router

    pub fn execute_token_router_upgrade(ctx: Context<ExecuteTokenRouterUpgrade>) -> Result<()> {
        utils::execute_upgrade(ctx.accounts, &ctx.bumps.execute_upgrade)
    }

    pub fn commit_token_router_upgrade(ctx: Context<CommitTokenRouterUpgrade>) -> Result<()> {
        processor::commit_token_router_upgrade(ctx)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn upgrade_authority() {
        let (actual_addr, actual_bump_seed) =
            Pubkey::find_program_address(&[UPGRADE_AUTHORITY_SEED_PREFIX], &crate::id());
        assert_eq!(actual_bump_seed, UPGRADE_AUTHORITY_BUMP);
        assert_eq!(actual_addr, common::UPGRADE_MANAGER_AUTHORITY);
    }
}
