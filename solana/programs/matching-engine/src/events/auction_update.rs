use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct AuctionUpdate {
    pub source_chain: u16,
    pub vaa_sequence: u64,
    pub end_slot: u64,
    pub amount_in: u64,
    pub max_offer_price_allowed: u64,
}
