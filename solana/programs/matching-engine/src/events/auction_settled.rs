use crate::state::MessageProtocol;
use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize)]
pub struct SettledTokenAccountInfo {
    pub key: Pubkey,
    pub balance_after: u64,
}

#[event]
#[derive(Debug)]
pub struct AuctionSettled {
    /// The pubkey of the auction that was settled.
    pub fast_vaa_hash: [u8; 32],

    /// If there was an active auction, this field will have the pubkey of the best offer token that
    /// was paid back and its balance after repayment.
    pub best_offer_token: Option<SettledTokenAccountInfo>,

    /// Depending on whether there was an active auction, this field will have the pubkey of the
    /// base fee token account (if there was an auction) or fee recipient token (if there was no
    /// auction).
    pub base_fee_token: Option<SettledTokenAccountInfo>,

    /// This value will only be some if there was no active auction.
    pub with_execute: Option<MessageProtocol>,
}
