use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct AuctionUpdate {
    pub auction: Pubkey,
    pub vaa: Option<Pubkey>,
    pub end_slot: u64,
    pub offer_token: Pubkey,
    pub amount_in: u64,
    pub total_deposit: u64,
    pub max_offer_price_allowed: u64,
}
