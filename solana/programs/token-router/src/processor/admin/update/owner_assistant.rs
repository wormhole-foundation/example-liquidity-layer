use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateOwnerAssistant<'info> {
    /// Owner of the program set in the [`OwnerConfig`] account.
    owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        has_one = owner @ TokenRouterError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,

    /// New Assistant.
    ///
    /// CHECK: Must be neither zero pubkey nor current owner assistant.
    #[account(
        constraint = new_owner_assistant.key() != Pubkey::default() @ TokenRouterError::InvalidNewAssistant,
    )]
    new_owner_assistant: AccountInfo<'info>,
}

pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
    ctx.accounts.custodian.owner_assistant = ctx.accounts.new_owner_assistant.key();

    // Done.
    Ok(())
}
