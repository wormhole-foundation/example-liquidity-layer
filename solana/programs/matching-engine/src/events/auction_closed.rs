use anchor_lang::prelude::*;

use crate::state::Auction;

#[event]
#[derive(Debug)]
pub struct AuctionClosed {
    pub auction: Auction,
}
