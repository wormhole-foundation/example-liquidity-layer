use crate::{composite::*, error::TokenRouterError};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateOwnerAssistant<'info> {
    admin: OwnerOnlyMut<'info>,

    /// New Assistant.
    ///
    /// CHECK: Must not be zero pubkey.
    #[account(
        constraint = {
            new_owner_assistant.key() != Pubkey::default()
        } @ TokenRouterError::InvalidNewAssistant,
    )]
    new_owner_assistant: AccountInfo<'info>,
}

pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
    common::admin::utils::assistant::transfer_owner_assistant(
        &mut ctx.accounts.admin.custodian,
        &ctx.accounts.new_owner_assistant,
    );

    // Done.
    Ok(())
}
