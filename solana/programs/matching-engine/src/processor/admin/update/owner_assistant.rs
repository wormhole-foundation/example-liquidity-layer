use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use common::admin::utils::assistant;

#[derive(Accounts)]
pub struct UpdateOwnerAssistant<'info> {
    /// Owner of the program set in the [`OwnerConfig`] account.
    owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        has_one = owner @ MatchingEngineError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,

    /// New Assistant.
    ///
    /// CHECK: Must not be zero pubkey.
    #[account(
        constraint = {
            new_owner_assistant.key() != Pubkey::default()
        } @ MatchingEngineError::InvalidNewAssistant,
    )]
    new_owner_assistant: AccountInfo<'info>,
}

pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
    assistant::transfer_owner_assistant(
        &mut ctx.accounts.custodian,
        &ctx.accounts.new_owner_assistant,
    );

    // Done.
    Ok(())
}
