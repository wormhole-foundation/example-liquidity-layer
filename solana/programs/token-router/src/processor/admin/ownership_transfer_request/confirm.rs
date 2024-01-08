use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ConfirmOwnershipTransferRequest<'info> {
    /// Must be the pending owner of the program set in the [`OwnerConfig`]
    /// account.
    pending_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        constraint = custodian.pending_owner.is_some() @ TokenRouterError::NoTransferOwnershipRequest,
        constraint = custodian.pending_owner.unwrap() == pending_owner.key() @ TokenRouterError::NotPendingOwner,
    )]
    custodian: Account<'info, Custodian>,
}

pub fn confirm_ownership_transfer_request(
    ctx: Context<ConfirmOwnershipTransferRequest>,
) -> Result<()> {
    let custodian = &mut ctx.accounts.custodian;
    custodian.owner = ctx.accounts.pending_owner.key();
    custodian.pending_owner = None;

    // Done.
    Ok(())
}
