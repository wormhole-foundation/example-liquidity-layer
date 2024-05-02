use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, PreparedOrderResponse},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ReserveFastFillSequenceNoAuction<'info> {
    reserve_sequence: ReserveFastFillSequence<'info>,

    /// The preparer will be the beneficiary of the reserved fast fill sequence account when it is
    /// closed. This instruction will not allow this account to be provided if there is an existing
    /// auction, which would enforce the order be executed when it is time to complete the auction.
    #[account(
        constraint = {
            // Check association with fast order path.
            require!(
                prepared_order_response.fast_vaa_hash
                    == reserve_sequence.fast_order_path.fast_vaa.load_unchecked().digest().0,
                MatchingEngineError::VaaMismatch
            );

            true
        }
    )]
    prepared_order_response: Account<'info, PreparedOrderResponse>,

    /// CHECK: This auction account may not exist. If it does not exist, the prepared order response
    /// must have been created by this point. Otherwise the auction account must reflect a completed
    /// auction.
    #[account(
        seeds = [
            Auction::SEED_PREFIX,
            prepared_order_response.fast_vaa_hash.as_ref(),
        ],
        bump,
        constraint = auction.data_is_empty() @ MatchingEngineError::AuctionExists,
    )]
    auction: UncheckedAccount<'info>,
}

pub fn reserve_fast_fill_sequence_no_auction(
    ctx: Context<ReserveFastFillSequenceNoAuction>,
) -> Result<()> {
    let prepared_order_response = &ctx.accounts.prepared_order_response;

    super::set_reserved_sequence_data(
        &mut ctx.accounts.reserve_sequence,
        &ctx.bumps.reserve_sequence,
        prepared_order_response.fast_vaa_hash,
        prepared_order_response.prepared_by,
    )
}
