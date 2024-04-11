use crate::{composite::*, error::MatchingEngineError};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SubmitOwnershipTransferRequest<'info> {
    admin: OwnerOnlyMut<'info>,

    /// New Owner.
    ///
    /// CHECK: Must be neither zero pubkey nor current owner.
    #[account(
        constraint = new_owner.key() != Pubkey::default() @ MatchingEngineError::InvalidNewOwner,
        constraint = new_owner.key() != admin.owner.key() @ MatchingEngineError::AlreadyOwner
    )]
    new_owner: UncheckedAccount<'info>,
}

pub fn submit_ownership_transfer_request(
    ctx: Context<SubmitOwnershipTransferRequest>,
) -> Result<()> {
    common::admin::utils::pending_owner::transfer_ownership(
        &mut ctx.accounts.admin.custodian,
        &ctx.accounts.new_owner.key(),
    );

    // Done.
    Ok(())
}
