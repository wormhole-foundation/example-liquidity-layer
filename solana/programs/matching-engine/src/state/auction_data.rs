use anchor_lang::prelude::*;

pub enum AuctionStatus {
    None,
    Active,
    Completed,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    pub bump: u8,

    /// Auction status.
    pub status: AuctionStatus,

    /// The highest bidder of the auction.
    pub highest_bidder: Pubkey,

    /// The initial bidder of the auction.
    pub initial_bidder: Pubkey,

    /// The slot at which the auction started.
    pub start_slot: u64,

    /// The amount of tokens to be sent to the user.
    pub amount: u64,

    /// The additional deposit made by the highest bidder.
    pub security_deposit: u64,

    /// The offer price of the auction.
    pub offer_price: u64,
}

impl Custodian {
    pub const SEED_PREFIX: &'static [u8] = b"auction";
}