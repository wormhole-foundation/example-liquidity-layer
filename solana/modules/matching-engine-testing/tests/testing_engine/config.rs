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

use std::{
    collections::{HashMap, HashSet},
    ops::Deref,
    rc::Rc,
};

use crate::{
    shimless::initialize::AuctionParametersConfig,
    utils::{
        auction::{ActiveAuctionState, AuctionAccounts},
        token_account::SplTokenEnum,
        Chain,
    },
};
use anchor_lang::prelude::*;
use solana_program_test::ProgramTestContext;
use solana_sdk::signature::Keypair;

use super::{
    setup::{Balance, Balances, TestingActor, TestingActors},
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
    pub payer_signer: Option<Rc<Keypair>>,
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
    pub vaa_index: usize,                               // If none defaults to 0
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
pub struct SetPauseCustodianInstructionConfig {
    pub payer_signer: Option<Rc<Keypair>>,
    pub is_paused: bool,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for SetPauseCustodianInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone, Default)]
pub struct PrepareOrderResponseInstructionConfig {
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub overwrite_auction_accounts: OverwriteCurrentState<AuctionAccounts>,
    pub actor_enum: TestingActorEnum,
    pub token_enum: SplTokenEnum,
    pub vaa_index: usize,
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl InstructionConfig for PrepareOrderResponseInstructionConfig {
    fn expected_error(&self) -> Option<&ExpectedError> {
        self.expected_error.as_ref()
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        self.expected_log_messages.as_ref()
    }
}

#[derive(Clone)]
pub struct ExecuteOrderInstructionConfig {
    pub fast_market_order_address: OverwriteCurrentState<Pubkey>,
    pub actor_enum: TestingActorEnum,
    pub token_enum: SplTokenEnum,
    pub vaa_index: usize,
    pub fast_forward_slots: u64, // Number of slots to fast forward, defaults to 3 in Default impl
    pub payer_signer: Option<Rc<Keypair>>,
    pub expected_error: Option<ExpectedError>,
    pub expected_log_messages: Option<Vec<ExpectedLog>>,
}

impl Default for ExecuteOrderInstructionConfig {
    fn default() -> Self {
        Self {
            fast_forward_slots: 3,
            actor_enum: TestingActorEnum::default(),
            fast_market_order_address: None,
            token_enum: SplTokenEnum::default(),
            vaa_index: 0,
            payer_signer: None,
            expected_error: None,
            expected_log_messages: None,
        }
    }
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
    pub overwrite_active_auction_state: OverwriteCurrentState<ActiveAuctionState>,
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

#[derive(Clone, PartialEq, Eq, Hash, Debug, Copy)]
pub enum TestingActorEnum {
    Solver(usize),
    Owner,
    OwnerAssistant,
    FeeRecipient,
    Relayer,
    Liquidator,
}

impl TestingActorEnum {
    pub fn get_actor(&self, testing_actors: &TestingActors) -> TestingActor {
        match self {
            Self::Solver(index) => testing_actors.solvers[*index].actor.clone(),
            Self::Owner => testing_actors.owner.clone(),
            Self::OwnerAssistant => testing_actors.owner_assistant.clone(),
            Self::FeeRecipient => testing_actors.fee_recipient.clone(),
            Self::Relayer => testing_actors.relayer.clone(),
            Self::Liquidator => testing_actors.liquidator.clone(),
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

pub struct VerifyBalancesConfig {
    pub previous_state_balances: Balances,
    pub balance_changes_config: BalanceChangesConfig,
    pub closed_token_account_enums: Option<HashSet<TestingActorEnum>>,
}

pub struct BalanceChangesConfig {
    pub actor: TestingActor,
    pub spl_token_enum: SplTokenEnum,
    pub custodian_token_previous_balance: u64,
}

impl VerifyBalancesConfig {
    pub async fn get_balance_changes(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
    ) -> BalanceChanges {
        BalanceChanges::execute_order_changes(
            test_context,
            current_state,
            &self.balance_changes_config,
        )
        .await
    }
}

pub struct ExecuteOrderActorEnums {
    pub executor: TestingActorEnum,
    pub best_offer: TestingActorEnum,
    pub initial_offer: TestingActorEnum,
}

impl ExecuteOrderActorEnums {
    pub fn from_state(state: &TestingEngineState) -> Self {
        Self {
            executor: state.execute_order_actor().unwrap(),
            best_offer: state.best_offer_actor().unwrap(),
            initial_offer: state.initial_offer_placed_actor().unwrap(),
        }
    }
}

#[derive(PartialEq, Eq, Debug, Clone)]
pub struct BalanceChanges(HashMap<TestingActorEnum, BalanceChange>);

impl Deref for BalanceChanges {
    type Target = HashMap<TestingActorEnum, BalanceChange>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<(&Balances, &Balances)> for BalanceChanges {
    fn from((initial_balances, final_balances): (&Balances, &Balances)) -> Self {
        let mut balance_changes = HashMap::new();

        let all_actors: HashSet<_> = initial_balances
            .keys()
            .chain(final_balances.keys())
            .collect();

        for actor in all_actors {
            let initial = initial_balances
                .get(actor)
                .cloned()
                .unwrap_or_else(|| Balance {
                    lamports: 0,
                    usdc: 0,
                    usdt: 0,
                });

            let final_bal = final_balances
                .get(actor)
                .cloned()
                .unwrap_or_else(|| Balance {
                    lamports: 0,
                    usdc: 0,
                    usdt: 0,
                });

            let balance_change = BalanceChange {
                lamports: i32::try_from(
                    i64::try_from(final_bal.lamports)
                        .unwrap()
                        .saturating_sub(i64::try_from(initial.lamports).unwrap()),
                )
                .unwrap(),
                usdc: i32::try_from(
                    i64::try_from(final_bal.usdc)
                        .unwrap()
                        .saturating_sub(i64::try_from(initial.usdc).unwrap()),
                )
                .unwrap(),
                usdt: i32::try_from(
                    i64::try_from(final_bal.usdt)
                        .unwrap()
                        .saturating_sub(i64::try_from(initial.usdt).unwrap()),
                )
                .unwrap(),
            };

            balance_changes.insert(*actor, balance_change);
        }

        Self(balance_changes)
    }
}

impl BalanceChanges {
    pub async fn execute_order_changes(
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        balance_changes_config: &BalanceChangesConfig,
    ) -> Self {
        let executor = &balance_changes_config.actor;
        let spl_token_enum = &balance_changes_config.spl_token_enum;
        let executor_testing_actor_enum = ExecuteOrderActorEnums::from_state(current_state);
        let ExecuteOrderActorEnums {
            executor: executor_testing_actor_enum,
            best_offer: best_offer_testing_actor_enum,
            initial_offer: initial_offer_testing_actor_enum,
        } = executor_testing_actor_enum;
        let active_auction_state = current_state
            .auction_state()
            .get_active_auction()
            .expect("Active auction is not initialized");
        // TODO: Make this dynamic so that it does not depend on the first vaa pair
        let fast_market_order = current_state
            .base()
            .get_fast_market_order(0)
            .expect("Fast market order is not initialized");
        let init_auction_fee = fast_market_order.init_auction_fee;
        let executor_token_address = executor.token_account_address(spl_token_enum).unwrap();
        let auction_calculations = active_auction_state
            .get_auction_calculations(
                test_context,
                executor_token_address,
                balance_changes_config.custodian_token_previous_balance,
                init_auction_fee,
            )
            .await;

        let mut balance_changes = HashMap::new();
        balance_changes.insert(
            executor_testing_actor_enum,
            BalanceChange {
                lamports: 0,
                usdc: match spl_token_enum {
                    SplTokenEnum::Usdc => {
                        auction_calculations
                            .expected_token_balance_changes
                            .executor_token_balance_change
                    }
                    SplTokenEnum::Usdt => 0,
                },
                usdt: match spl_token_enum {
                    SplTokenEnum::Usdc => 0,
                    SplTokenEnum::Usdt => {
                        auction_calculations
                            .expected_token_balance_changes
                            .executor_token_balance_change
                    }
                },
            },
        );

        balance_changes.insert(
            best_offer_testing_actor_enum,
            BalanceChange {
                lamports: 0,
                usdc: match spl_token_enum {
                    SplTokenEnum::Usdc => {
                        auction_calculations
                            .expected_token_balance_changes
                            .best_offer_token_balance_change
                    }
                    SplTokenEnum::Usdt => 0,
                },
                usdt: match spl_token_enum {
                    SplTokenEnum::Usdc => 0,
                    SplTokenEnum::Usdt => {
                        auction_calculations
                            .expected_token_balance_changes
                            .best_offer_token_balance_change
                    }
                },
            },
        );

        balance_changes.insert(
            initial_offer_testing_actor_enum,
            BalanceChange {
                lamports: 0,
                usdc: match spl_token_enum {
                    SplTokenEnum::Usdc => {
                        auction_calculations
                            .expected_token_balance_changes
                            .initial_offer_token_balance_change
                    }
                    SplTokenEnum::Usdt => 0,
                },
                usdt: match spl_token_enum {
                    SplTokenEnum::Usdc => 0,
                    SplTokenEnum::Usdt => {
                        auction_calculations
                            .expected_token_balance_changes
                            .initial_offer_token_balance_change
                    }
                },
            },
        );
        Self(balance_changes)
    }
}
#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct BalanceChange {
    pub lamports: i32,
    pub usdc: i32,
    pub usdt: i32,
}
