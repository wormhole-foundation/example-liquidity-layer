use crate::{composite::*, error::MatchingEngineError};
use anchor_lang::prelude::*;
use common::admin::utils::assistant;

#[derive(Accounts)]
pub struct UpdateOwnerAssistant<'info> {
    admin: OwnerOnlyMut<'info>,

    /// New Assistant.
    ///
    /// CHECK: Must not be zero pubkey.
    #[account(
        constraint = {
            new_owner_assistant.key() != Pubkey::default()
        } @ MatchingEngineError::AssistantZeroPubkey,
    )]
    new_owner_assistant: AccountInfo<'info>,
}

pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
    assistant::transfer_owner_assistant(
        &mut ctx.accounts.admin.custodian,
        &ctx.accounts.new_owner_assistant,
    );

    // Done.
    Ok(())
}
