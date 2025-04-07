//! # Testing Engine Config
//!
//! This module contains the configuration arguments for the testing engine.
//!
//! ## Examples
//!
//! ```
//! use crate::testing_engine::config::*;
//!
//! let initialize_instruction_config = InitializeInstructionConfig::default();
//!
//! let instruction_triggers = vec![
//!     InstructionTrigger::InitializeProgram(initialize_instruction_config),
//! ];
//! ```

use std::{collections::HashSet, rc::Rc};

use crate::{
    shimless::initialize::AuctionParametersConfig,
    utils::{token_account::SplTokenEnum, Chain},
};
use anchor_lang::prelude::*;
use solana_sdk::signature::Keypair;

use super::{
    setup::{TestingActor, TestingActors},
    state::TestingEngineState,
};

/// An instruction config contains the configuration arguments for an instruction as well as the expected error
pub trait InstructionConfig: Default {
    fn expected_error(&self) -> Option<&ExpectedError>;
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>>;
}

/// A type alias for an optional value that overwrites the current state
pub type OverwriteCurrentState<T> = Option<T>;

/// A struct representing an expected error
///
/// # Fields
///
/// * `instruction_index` - The index of the instruction that is expected to error
/// * `error_code` - The error code that is expected to be returned
/// * `error_string` - A description of the error that is expected to be returned for debugging purposes
// TODO: Change the error string to either be checked for or change the field name AND make it optional
#[derive(Clone)]
pub struct ExpectedError {
    pub instruction_index: u8,
    pub error_code: u32,
    pub error_string: String,
}

/// A struct representing an expected log
///
/// # Fields
///
/// * `log_message` - The log message that is expected to be returned
/// * `count` - The number of times the log message is expected to appear
#[derive(Clone)]
pub struct ExpectedLog {
    pub log_message: String,
    pub count: usize,
}

#[derive(Clone, Default)]
pub struct InitializeInstructionConfig {
    pub auction_parameters_config: AuctionParametersConfig,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for InitializeInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}
pub struct CreateCctpRouterEndpointsInstructionConfig {
    pub chains: HashSet<Chain>,
    pub payer_signer: Option<Rc<Keypair>>,
    pub admin_owner_or_assistant: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl Default for CreateCctpRouterEndpointsInstructionConfig {
    fn default() -> Self {
        Self {
            chains: HashSet::from([Chain::Ethereum, Chain::Arbitrum, Chain::Solana]),
            payer_signer: None,
            admin_owner_or_assistant: None,
            expected_error: None,
            expected_log_messages: None,
        }
    }
}

impl InstructionConfig for CreateCctpRouterEndpointsInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone, Default)]
pub struct InitializeFastMarketOrderShimInstructionConfig {
    pub fast_market_order_id: u32,
    pub close_account_refund_recipient: Option<Pubkey>, // If none defaults to solver 0 pubkey,
    pub payer_signer: Option<Rc<Keypair>>,              // If none defaults to owner keypair
    pub expected_error: Option<ExpectedError>,          // If none, will not check for an error
    pub expected_log_messages: Option<Vec<ExpectedLog>>, // If none, will not check for logs
}

impl InstructionConfig for InitializeFastMarketOrderShimInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone, Default)]
pub struct PrepareOrderInstructionConfig {
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub solver_index: usize,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for PrepareOrderInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone, Default)]
pub struct ExecuteOrderInstructionConfig {
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub solver_index: usize,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for ExecuteOrderInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone, Default)]
pub struct SettleAuctionInstructionConfig {
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for SettleAuctionInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone, Default)]
pub struct CloseFastMarketOrderShimInstructionConfig {
    pub close_account_refund_recipient_keypair: Option<Rc<Keypair>>, // If none, will use the solver 0 keypair
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>, // If none, will use the fast market order address from the current state
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for CloseFastMarketOrderShimInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone)]
pub enum TestingActorEnum {
    Solver(usize),
    Owner,
}

impl TestingActorEnum {
    pub fn get_actor(&self, testing_actors: &TestingActors) -> TestingActor {
        match self {
            Self::Solver(index) => testing_actors.solvers[*index].actor.clone(),
            Self::Owner => testing_actors.owner.clone(),
        }
    }
}

impl Default for TestingActorEnum {
    fn default() -> Self {
        Self::Solver(0)
    }
}

#[derive(Clone, Default)]
pub struct PlaceInitialOfferCustomAccounts {
    pub fast_market_order_address: Option<Pubkey>,
    pub offer_token_address: Option<Pubkey>,
    pub auction_config_address: Option<Pubkey>,
    pub from_router_endpoint: Option<Pubkey>,
    pub to_router_endpoint: Option<Pubkey>,
    pub custodian_address: Option<Pubkey>,
    pub mint_address: Option<Pubkey>,
    pub system_program_address: Option<Pubkey>,
    pub token_program_address: Option<Pubkey>,
}

pub struct PlaceInitialOfferInstructionConfig {
    pub actor: TestingActorEnum,
    pub test_vaa_pair_index: usize,
    pub offer_price: u64,
    pub payer_signer: Option<Rc<Keypair>>,
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub custom_accounts: OverwriteCurrentState<PlaceInitialOfferCustomAccounts>,
    pub spl_token_enum: SplTokenEnum,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl PlaceInitialOfferInstructionConfig {
    pub fn get_from_and_to_router_endpoints(
        &self,
        current_state: &TestingEngineState,
    ) -> (Pubkey, Pubkey) {
        match &self.custom_accounts {
            Some(custom_accounts) => {
                let from_router_endpoint = match custom_accounts.from_router_endpoint {
                    Some(from_router_endpoint) => from_router_endpoint,
                    None => {
                        current_state
                            .router_endpoints()
                            .expect("Router endpoints are not initialized")
                            .endpoints
                            .get_from_and_to_endpoint_addresses(
                                current_state.base().transfer_direction,
                            )
                            .0
                    }
                };
                let to_router_endpoint = match custom_accounts.to_router_endpoint {
                    Some(to_router_endpoint) => to_router_endpoint,
                    None => {
                        current_state
                            .router_endpoints()
                            .expect("Router endpoints are not initialized")
                            .endpoints
                            .get_from_and_to_endpoint_addresses(
                                current_state.base().transfer_direction,
                            )
                            .1
                    }
                };
                (from_router_endpoint, to_router_endpoint)
            }
            None => current_state
                .router_endpoints()
                .expect("Router endpoints are not initialized")
                .endpoints
                .get_from_and_to_endpoint_addresses(current_state.base().transfer_direction),
        }
    }
}

impl Default for PlaceInitialOfferInstructionConfig {
    fn default() -> Self {
        Self {
            actor: TestingActorEnum::Solver(0),
            test_vaa_pair_index: 0,
            offer_price: 1__000_000,
            payer_signer: None,
            fast_market_order_address: None,
            custom_accounts: None,
            spl_token_enum: SplTokenEnum::Usdc,
            expected_error: None,
            expected_log_messages: None,
        }
    }
}

impl InstructionConfig for PlaceInitialOfferInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

pub struct ImproveOfferInstructionConfig {
    pub actor: TestingActorEnum,
    pub offer_price: u64,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl Default for ImproveOfferInstructionConfig {
    fn default() -> Self {
        Self {
            actor: TestingActorEnum::Solver(0),
            offer_price: 500_000,
            payer_signer: None,
            expected_error: None,
            expected_log_messages: None,
        }
    }
}

impl InstructionConfig for ImproveOfferInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}
