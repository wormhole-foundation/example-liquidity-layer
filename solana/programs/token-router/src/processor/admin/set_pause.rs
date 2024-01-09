use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use ownable_tools::utils::assistant::only_authorized;

#[derive(Accounts)]
pub struct SetPause<'info> {
    owner_or_assistant: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        constraint = only_authorized(&custodian, &owner_or_assistant.key()) @ TokenRouterError::OwnerOrAssistantOnly,
    )]
    /// Sender Config account. This program requires that the `owner` specified
    /// in the context equals the pubkey specified in this account. Mutable.
    custodian: Account<'info, Custodian>,
}

pub fn set_pause(ctx: Context<SetPause>, paused: bool) -> Result<()> {
    let custodian = &mut ctx.accounts.custodian;
    custodian.paused = paused;
    custodian.paused_set_by = ctx.accounts.owner_or_assistant.key();

    // Done.
    Ok(())
}
