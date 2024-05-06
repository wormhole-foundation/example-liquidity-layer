use crate::{error::MatchingEngineError, state::FastFill};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseRedeemedFastFill<'info> {
    /// Instead of having the preparer sign for this instruction, we allow anyone to call this
    /// instruction on behalf of the preparer.
    ///
    /// CHECK: Must equal the `prepared_by` field of the `fast_fill` account.
    #[account(
        mut,
        address = fast_fill.prepared_by,
    )]
    prepared_by: UncheckedAccount<'info>,

    #[account(
        mut,
        close = prepared_by,
        constraint = fast_fill.redeemed @ MatchingEngineError::FastFillNotRedeemed,
    )]
    fast_fill: Account<'info, FastFill>,
}

pub fn close_redeemed_fast_fill(_ctx: Context<CloseRedeemedFastFill>) -> Result<()> {
    Ok(())
}
