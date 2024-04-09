use crate::state::MessageProtocol;
use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct AuctionUpdated {
    pub config_id: u32,
    pub auction: Pubkey,
    pub vaa: Option<Pubkey>,
    pub source_chain: u16,
    pub target_protocol: MessageProtocol,
    pub end_slot: u64,
    pub best_offer_token: Pubkey,
    pub token_balance_before: u64,
    pub amount_in: u64,
    pub total_deposit: u64,
    pub max_offer_price_allowed: u64,
}
