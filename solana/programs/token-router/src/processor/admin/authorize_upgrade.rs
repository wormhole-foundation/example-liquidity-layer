use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AuthorizeUpgrade<'info> {
    owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        has_one = owner @ TokenRouterError::OwnerOnly,
        constraint = custodian.pending_owner.is_none(), // TODO: add error
    )]
    custodian: Account<'info, Custodian>,

    #[account(address = common::constants::UPGRADE_MANAGER_AUTHORITY)]
    upgrade_manager_authority: Signer<'info>,
}

pub fn authorize_upgrade(ctx: Context<AuthorizeUpgrade>) -> Result<()> {
    ctx.accounts.custodian.owner = ctx.accounts.upgrade_manager_authority.key();

    // Done.
    Ok(())
}
