use anchor_lang::prelude::*;

use matching_engine::state::Auction;
use matching_engine::instruction::{CreateNewAuctionHistory, CreateFirstAuctionHistory, PlaceInitialOfferCctp};


pub async fn place_initial_offer(
    testing_context: &mut TestingContext,
    auction_config_id: u64,
    fast_market_order: FastMarketOrder,
) {
    
}