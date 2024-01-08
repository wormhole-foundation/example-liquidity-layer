use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelOwnershipTransferRequest<'info> {
    owner: Signer<'info>,

    /// Custodian, which can only be modified by the configured owner.
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        has_one = owner @ TokenRouterError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,
}

pub fn cancel_ownership_transfer_request(
    ctx: Context<CancelOwnershipTransferRequest>,
) -> Result<()> {
    ctx.accounts.custodian.pending_owner = None;

    // Done.
    Ok(())
}
