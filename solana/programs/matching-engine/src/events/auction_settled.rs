use crate::state::MessageProtocol;
use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct AuctionSettled {
    /// The pubkey of the auction that was settled.
    pub auction: Pubkey,

    /// If there was an active auction, this pubkey is the best offer token that was paid back.
    pub best_offer_token: Option<Pubkey>,

    /// Token account's new balance. If there was no auction, this balance will be of the fee
    /// recipient token account.
    pub token_balance_after: u64,

    /// This value will only be some if there was no active auction.
    pub with_execute: Option<MessageProtocol>,
}
