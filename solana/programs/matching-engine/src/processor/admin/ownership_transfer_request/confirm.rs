use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use common::admin::utils::pending_owner;

#[derive(Accounts)]
pub struct ConfirmOwnershipTransferRequest<'info> {
    /// Must be the pending owner of the program set in the [`OwnerConfig`]
    /// account.
    pending_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        constraint = {
            custodian.pending_owner.is_some()
        } @ MatchingEngineError::NoTransferOwnershipRequest,
        constraint = {
            pending_owner::only_pending_owner_unchecked(&custodian, &pending_owner.key())
        } @ MatchingEngineError::NotPendingOwner,
    )]
    custodian: Account<'info, Custodian>,
}

pub fn confirm_ownership_transfer_request(
    ctx: Context<ConfirmOwnershipTransferRequest>,
) -> Result<()> {
    pending_owner::accept_ownership_unchecked(&mut ctx.accounts.custodian);

    // Done.
    Ok(())
}
