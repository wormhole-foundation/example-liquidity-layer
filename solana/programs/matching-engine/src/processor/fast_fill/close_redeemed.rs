use crate::{error::MatchingEngineError, state::FastFill};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseRedeemedFastFill<'info> {
    #[account(mut)]
    prepared_by: Signer<'info>,

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
