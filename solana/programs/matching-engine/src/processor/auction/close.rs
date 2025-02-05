use std::ops::Deref;

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionStatus},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[event_cpi]
pub struct CloseAuction<'info> {
    #[account(
        mut,
        close = beneficiary,
        constraint = {
            require!(
                matches!(auction.status, AuctionStatus::Settled {..}),
                MatchingEngineError::AuctionNotSettled,
            );

            let expiration =
                i64::from(auction.vaa_timestamp).saturating_add(crate::VAA_AUCTION_EXPIRATION_TIME);
            require!(
                Clock::get().unwrap().unix_timestamp >= expiration,
                MatchingEngineError::CannotCloseAuctionYet,
            );

            true
        }
    )]
    auction: Account<'info, Auction>,

    /// CHECK: This account is whoever originally created the auction account (see
    /// [Auction::prepared_by].
    #[account(
        mut,
        address = auction.prepared_by,
    )]
    beneficiary: UncheckedAccount<'info>,
}

pub fn close_auction(ctx: Context<CloseAuction>) -> Result<()> {
    emit_cpi!(crate::events::AuctionClosed {
        auction: ctx.accounts.auction.deref().clone(),
    });

    Ok(())
}
