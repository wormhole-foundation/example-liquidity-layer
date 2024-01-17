use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum AuctionStatus {
    NotStarted,
    Active,
    Completed,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct AuctionData {
    pub bump: u8,

    /// VAA hash of the auction.
    pub vaa_hash: [u8; 32],

    /// Auction status.
    pub status: AuctionStatus,

    /// The highest bidder of the auction.
    pub best_offer_token: Pubkey,

    /// The initial bidder of the auction.
    pub initial_offer_token: Pubkey,

    /// The slot at which the auction started.
    pub start_slot: u64,

    /// The amount of tokens to be sent to the user.
    pub amount: u64,

    /// The additional deposit made by the highest bidder.
    pub security_deposit: u64,

    /// The offer price of the auction.
    pub offer_price: u64,
}

impl AuctionData {
    pub const SEED_PREFIX: &'static [u8] = b"auction";
}
