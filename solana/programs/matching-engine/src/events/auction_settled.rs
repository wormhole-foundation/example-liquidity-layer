use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct AuctionSettled {
    pub auction: Pubkey,
    pub best_offer_token: Pubkey,
    pub token_balance_after: u64,
}
