use std::collections::HashSet;

use crate::{shimless::initialize::AuctionParametersConfig, utils::Chain};
use anchor_lang::prelude::*;

#[derive(Clone)]
pub struct ExpectedError {
    pub instruction_index: u8,
    pub error_code: u32,
    pub error_string: String,
}

#[derive(Clone)]
pub struct InitializeInstructionConfig {
    pub auction_parameters_config: AuctionParametersConfig,
    pub expected_error: Option<ExpectedError>,
}

impl Default for InitializeInstructionConfig {
    fn default() -> Self {
        Self {
            auction_parameters_config: AuctionParametersConfig::default(),
            expected_error: None,
        }
    }
}

pub struct CreateCctpRouterEndpointsInstructionConfig {
    pub chains: HashSet<Chain>,
    pub expected_error: Option<ExpectedError>,
}

impl Default for CreateCctpRouterEndpointsInstructionConfig {
    fn default() -> Self {
        Self {
            chains: HashSet::from([Chain::Ethereum, Chain::Arbitrum, Chain::Solana]),
            expected_error: None,
        }
    }
}
#[derive(Clone)]
pub struct InitializeFastMarketOrderShimInstructionConfig {
    pub fast_market_order_id: u32,
    pub close_account_refund_recipient: Pubkey,
    pub expected_error: Option<ExpectedError>,
}

impl Default for InitializeFastMarketOrderShimInstructionConfig {
    fn default() -> Self {
        Self {
            fast_market_order_id: 0,
            close_account_refund_recipient: Pubkey::new_unique(),
            expected_error: None,
        }
    }
}

pub struct PlaceInitialOfferInstructionConfig {
    pub solver_index: usize,
    pub offer_price: u64,
    pub expected_error: Option<ExpectedError>,
}

impl Default for PlaceInitialOfferInstructionConfig {
    fn default() -> Self {
        Self {
            solver_index: 0,
            offer_price: 1__000_000,
            expected_error: None,
        }
    }
}

pub struct ImproveOfferInstructionConfig {
    pub solver_index: usize,
    pub offer_price: u64,
    pub expected_error: Option<ExpectedError>,
}

impl Default for ImproveOfferInstructionConfig {
    fn default() -> Self {
        Self {
            solver_index: 0,
            offer_price: 500_000,
            expected_error: None,
        }
    }
}
