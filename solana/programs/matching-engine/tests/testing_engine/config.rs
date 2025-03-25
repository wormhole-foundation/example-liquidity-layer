use std::{collections::HashSet, rc::Rc};

use crate::{shimless::initialize::AuctionParametersConfig, utils::Chain};
use anchor_lang::prelude::*;
use solana_sdk::signature::Keypair;

pub type OverwriteCurrentState<T> = Option<T>;

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
    pub close_account_refund_recipient: Option<Pubkey>, // If none defaults to solver 0 pubkey,
    pub payer_signer: Option<Rc<Keypair>>,              // If none defaults to owner keypair
    pub expected_error: Option<ExpectedError>,
}

impl Default for InitializeFastMarketOrderShimInstructionConfig {
    fn default() -> Self {
        Self {
            fast_market_order_id: 0,
            close_account_refund_recipient: None,
            payer_signer: None,
            expected_error: None,
        }
    }
}

#[derive(Clone)]
pub struct PrepareOrderInstructionConfig {
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
}

impl Default for PrepareOrderInstructionConfig {
    fn default() -> Self {
        Self {
            fast_market_order_address: None,
            payer_signer: None,
            expected_error: None,
        }
    }
}
#[derive(Clone)]
pub struct ExecuteOrderInstructionConfig {
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub solver_index: usize,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
}

impl Default for ExecuteOrderInstructionConfig {
    fn default() -> Self {
        Self {
            fast_market_order_address: None,
            solver_index: 0,
            payer_signer: None,
            expected_error: None,
        }
    }
}

#[derive(Clone)]
pub struct SettleAuctionInstructionConfig {
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
}

impl Default for SettleAuctionInstructionConfig {
    fn default() -> Self {
        Self {
            payer_signer: None,
            expected_error: None,
        }
    }
}
#[derive(Clone)]
pub struct CloseFastMarketOrderShimInstructionConfig {
    pub close_account_refund_recipient_keypair: Option<Rc<Keypair>>, // If none, will use the solver 0 keypair
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>, // If none, will use the fast market order address from the current state
    pub expected_error: Option<ExpectedError>,
}

impl Default for CloseFastMarketOrderShimInstructionConfig {
    fn default() -> Self {
        Self {
            close_account_refund_recipient_keypair: None,
            fast_market_order_address: None,
            expected_error: None,
        }
    }
}

pub struct PlaceInitialOfferInstructionConfig {
    pub solver_index: usize,
    pub offer_price: u64,
    pub payer_signer: Option<Rc<Keypair>>,
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub expected_error: Option<ExpectedError>,
}

impl Default for PlaceInitialOfferInstructionConfig {
    fn default() -> Self {
        Self {
            solver_index: 0,
            offer_price: 1__000_000,
            payer_signer: None,
            fast_market_order_address: None,
            expected_error: None,
        }
    }
}

pub struct ImproveOfferInstructionConfig {
    pub solver_index: usize,
    pub offer_price: u64,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
}

impl Default for ImproveOfferInstructionConfig {
    fn default() -> Self {
        Self {
            solver_index: 0,
            offer_price: 500_000,
            payer_signer: None,
            expected_error: None,
        }
    }
}
