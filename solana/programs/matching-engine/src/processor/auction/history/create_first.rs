use crate::state::AuctionHistory;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateFirstAuctionHistory<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = AuctionHistory::START,
        seeds = [
            AuctionHistory::SEED_PREFIX,
            &u64::default().to_be_bytes()
        ],
        bump,
    )]
    first_history: Account<'info, AuctionHistory>,

    system_program: Program<'info, System>,
}

pub fn create_first_auction_history(ctx: Context<CreateFirstAuctionHistory>) -> Result<()> {
    ctx.accounts.first_history.set_inner(Default::default());

    // Done.
    Ok(())
}
