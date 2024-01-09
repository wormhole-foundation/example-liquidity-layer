use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use ownable_tools::utils::{ownable, pending_owner};

#[derive(Accounts)]
pub struct SubmitOwnershipTransferRequest<'info> {
    owner: Signer<'info>,

    /// Custodian, which can only be modified by the configured owner.
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        constraint = ownable::only_owner(&custodian, &owner.key()) @ TokenRouterError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,

    /// New Owner.
    ///
    /// CHECK: Must be neither zero pubkey nor current owner.
    #[account(
        constraint = new_owner.key() != Pubkey::default() @ TokenRouterError::InvalidNewOwner,
        constraint = new_owner.key() != owner.key() @ TokenRouterError::AlreadyOwner
    )]
    new_owner: AccountInfo<'info>,
}

pub fn submit_ownership_transfer_request(
    ctx: Context<SubmitOwnershipTransferRequest>,
) -> Result<()> {
    pending_owner::transfer_ownership(&mut ctx.accounts.custodian, &ctx.accounts.new_owner.key());

    // Done.
    Ok(())
}
