use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelOwnershipTransferRequest<'info> {
    owner: Signer<'info>,

    /// Custodian, which can only be modified by the configured owner.
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        constraint = ownable_tools::utils::ownable::only_owner(&custodian, &owner.key()) @ MatchingEngineError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,
}

pub fn cancel_ownership_transfer_request(
    ctx: Context<CancelOwnershipTransferRequest>,
) -> Result<()> {
    ownable_tools::utils::pending_owner::cancel_transfer_ownership(&mut ctx.accounts.custodian);

    // Done.
    Ok(())
}
