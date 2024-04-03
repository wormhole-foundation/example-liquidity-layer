use crate::{
    error::MatchingEngineError,
    state::{AuctionHistory, AuctionHistoryHeader, AuctionHistoryInternal},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateNewAuctionHistory<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(
        seeds = [
            AuctionHistory::SEED_PREFIX,
            &current_history.id.to_be_bytes()
        ],
        bump,
        constraint = {
            require_eq!(
                current_history.num_entries,
                AuctionHistory::MAX_ENTRIES,
                MatchingEngineError::AuctionHistoryNotFull,
            );

            true
        }
    )]
    current_history: Account<'info, AuctionHistoryInternal>,

    #[account(
        init,
        payer = payer,
        space = AuctionHistory::START,
        seeds = [
            AuctionHistory::SEED_PREFIX,
            &(current_history.id + 1).to_be_bytes()
        ],
        bump,
    )]
    new_history: Account<'info, AuctionHistory>,

    system_program: Program<'info, System>,
}

pub fn create_new_auction_history(ctx: Context<CreateNewAuctionHistory>) -> Result<()> {
    ctx.accounts.new_history.set_inner(AuctionHistory {
        header: AuctionHistoryHeader::new(ctx.accounts.current_history.id + 1),
        data: Default::default(),
    });

    // Done.
    Ok(())
}
