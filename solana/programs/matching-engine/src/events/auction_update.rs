use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct AuctionUpdate {
    pub auction: Pubkey,
    pub vaa: Option<Pubkey>,
    pub end_slot: u64,
    pub best_offer_token: Pubkey,
    pub token_balance_before: u64,
    pub amount_in: u64,
    pub total_deposit: u64,
    pub max_offer_price_allowed: u64,
}
