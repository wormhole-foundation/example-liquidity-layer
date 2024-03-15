use crate::processor::shared_contexts::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelOwnershipTransferRequest<'info> {
    admin: OwnerMutCustodian<'info>,
}

pub fn cancel_ownership_transfer_request(
    ctx: Context<CancelOwnershipTransferRequest>,
) -> Result<()> {
    common::admin::utils::pending_owner::cancel_transfer_ownership(
        &mut ctx.accounts.admin.custodian,
    );

    // Done.
    Ok(())
}
