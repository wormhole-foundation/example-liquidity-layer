//! # Testing Engine
//!
//! This module contains the testing engine for the matching engine program.
//! It is used to test the matching engine program with a functional style.
//!
//! ## Features
//!
//! - Testing engine struct (TestingEngine struct)
//! - Execute instructions (impl TestingEngine)
//! - Fast forward slots (fn fast_forward_slots)
//!
//! ## Examples
//!
//! ```
//! use crate::testing_engine::engine::*;
//!
//! let testing_context = setup_testing_context(//arguments);
//! let testing_engine = TestingEngine::new(testing_context).await;
//! let instruction_triggers = vec![
//!     InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
//! ];
//! testing_engine.execute(instruction_triggers).await;
//! ```

use std::ops::{Deref, DerefMut};

use matching_engine::state::FastMarketOrder;
use solana_program_test::ProgramTestContext;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;

use super::setup::TestingContext;
use super::{config::*, state::*};
use crate::shimful;
use crate::shimful::fast_market_order_shim::{
    create_fast_market_order_state_from_vaa_data, initialize_fast_market_order_shimful,
    initialize_fast_market_order_shimful_instruction,
};
use crate::shimful::shims_make_offer::{
    evaluate_place_initial_offer_shimful_state, place_initial_offer_shimful_instruction,
    PlaceInitialOfferShimfulAccounts,
};
use crate::shimful::verify_shim::create_guardian_signatures;
use crate::shimless;
use crate::shimless::initialize::initialize_program;
use crate::testing_engine::setup::ShimMode;
use crate::utils::token_account::SplTokenEnum;
use crate::utils::vaa::TestVaaPairs;
use crate::utils::{auction::AuctionAccounts, router::create_all_router_endpoints_test};
use anchor_lang::prelude::*;

pub enum InstructionTrigger {
    InitializeProgram(InitializeInstructionConfig),
    CreateCctpRouterEndpoints(CreateCctpRouterEndpointsInstructionConfig),
    InitializeFastMarketOrderShim(InitializeFastMarketOrderShimInstructionConfig),
    SetPauseCustodian(SetPauseCustodianInstructionConfig),
    PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig),
    PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig),
    ImproveOfferShimless(ImproveOfferInstructionConfig),
    ExecuteOrderShimless(ExecuteOrderInstructionConfig),
    ExecuteOrderShim(ExecuteOrderInstructionConfig),
    PrepareOrderShimless(PrepareOrderResponseInstructionConfig),
    PrepareOrderShim(PrepareOrderResponseInstructionConfig),
    SettleAuction(SettleAuctionInstructionConfig),
    CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig),
}

pub enum VerificationTrigger {
    // Verify that the auction state is as expected (bool is expected to succeed)
    VerifyAuctionState(bool),
    // Verify that the execute order math is correct
    VerifyBalances(Box<VerifyBalancesConfig>),
}

pub enum CombinationTrigger {
    CreateFastMarketOrderAndPlaceInitialOffer(Box<CombinedInstructionConfig>),
}

pub enum ExecutionTrigger {
    Instruction(Box<InstructionTrigger>),
    Verification(Box<VerificationTrigger>),
    CombinationTrigger(Box<CombinationTrigger>),
}

impl From<InstructionTrigger> for ExecutionTrigger {
    fn from(trigger: InstructionTrigger) -> Self {
        ExecutionTrigger::Instruction(Box::new(trigger))
    }
}

impl From<VerificationTrigger> for ExecutionTrigger {
    fn from(trigger: VerificationTrigger) -> Self {
        ExecutionTrigger::Verification(Box::new(trigger))
    }
}

impl From<CombinationTrigger> for ExecutionTrigger {
    fn from(trigger: CombinationTrigger) -> Self {
        ExecutionTrigger::CombinationTrigger(Box::new(trigger))
    }
}

pub struct ExecutionChain(Vec<ExecutionTrigger>);

impl Deref for ExecutionChain {
    type Target = Vec<ExecutionTrigger>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for ExecutionChain {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl ExecutionChain {
    pub fn new(triggers: Vec<ExecutionTrigger>) -> Self {
        Self(triggers)
    }

    pub fn instruction_triggers(&self) -> Vec<&InstructionTrigger> {
        self.iter()
            .filter_map(|trigger| {
                if let ExecutionTrigger::Instruction(boxed_trigger) = trigger {
                    Some(boxed_trigger.as_ref())
                } else {
                    None
                }
            })
            .collect()
    }
}
impl From<Vec<InstructionTrigger>> for ExecutionChain {
    fn from(triggers: Vec<InstructionTrigger>) -> Self {
        Self(triggers.into_iter().map(|trigger| trigger.into()).collect())
    }
}

impl From<Vec<VerificationTrigger>> for ExecutionChain {
    fn from(triggers: Vec<VerificationTrigger>) -> Self {
        Self(triggers.into_iter().map(|trigger| trigger.into()).collect())
    }
}

impl From<Vec<CombinationTrigger>> for ExecutionChain {
    fn from(triggers: Vec<CombinationTrigger>) -> Self {
        Self(triggers.into_iter().map(|trigger| trigger.into()).collect())
    }
}

impl InstructionTrigger {
    pub fn is_shim(&self) -> bool {
        matches!(
            self,
            Self::PlaceInitialOfferShim(_)
                | Self::ExecuteOrderShim(_)
                | Self::PrepareOrderShim(_)
                | Self::InitializeFastMarketOrderShim(_)
                | Self::CloseFastMarketOrderShim(_)
        )
    }
}
// Implement InstructionConfig for InstructionTrigger
impl InstructionConfig for InstructionTrigger {
    fn expected_error(&self) -> Option<&ExpectedError> {
        match self {
            Self::InitializeProgram(config) => config.expected_error(),
            Self::CreateCctpRouterEndpoints(config) => config.expected_error(),
            Self::InitializeFastMarketOrderShim(config) => config.expected_error(),
            Self::SetPauseCustodian(config) => config.expected_error(),
            Self::PlaceInitialOfferShimless(config) => config.expected_error(),
            Self::PlaceInitialOfferShim(config) => config.expected_error(),
            Self::ImproveOfferShimless(config) => config.expected_error(),
            Self::ExecuteOrderShimless(config) => config.expected_error(),
            Self::ExecuteOrderShim(config) => config.expected_error(),
            Self::PrepareOrderShimless(config) => config.expected_error(),
            Self::PrepareOrderShim(config) => config.expected_error(),
            Self::SettleAuction(config) => config.expected_error(),
            Self::CloseFastMarketOrderShim(config) => config.expected_error(),
        }
    }
    fn expected_log_messages(&self) -> Option<&Vec<ExpectedLog>> {
        match self {
            Self::InitializeProgram(config) => config.expected_log_messages(),
            Self::CreateCctpRouterEndpoints(config) => config.expected_log_messages(),
            Self::InitializeFastMarketOrderShim(config) => config.expected_log_messages(),
            Self::SetPauseCustodian(config) => config.expected_log_messages(),
            Self::PlaceInitialOfferShimless(config) => config.expected_log_messages(),
            Self::PlaceInitialOfferShim(config) => config.expected_log_messages(),
            Self::ImproveOfferShimless(config) => config.expected_log_messages(),
            Self::ExecuteOrderShim(config) => config.expected_log_messages(),
            Self::ExecuteOrderShimless(config) => config.expected_log_messages(),
            Self::PrepareOrderShim(config) => config.expected_log_messages(),
            Self::PrepareOrderShimless(config) => config.expected_log_messages(),
            Self::SettleAuction(config) => config.expected_log_messages(),
            Self::CloseFastMarketOrderShim(config) => config.expected_log_messages(),
        }
    }
}

// If you need a default implementation
impl Default for InstructionTrigger {
    fn default() -> Self {
        Self::InitializeProgram(InitializeInstructionConfig::default())
    }
}

/// Functional style testing engine for the matching engine program
///
/// This engine is used to test the matching engine program with a functional style.
/// Instruction triggers are enums that compose instructions to be executed.
/// Instruction triggers are executed in the order they are provided.
/// The engine is stateful and will track the state of the program.
/// The engine will return the updated state after each instruction trigger.
/// If an instruction trigger fails, the engine will return the previous state.
///
/// Instruction triggers (enums) take a configuration struct as an argument.
/// Each instruction config implements the InstructionConfig trait.
/// The configuration struct contains fields for the expected error, and for
/// providing test specific configuration.
///
/// Each instruction config struct implements a default constructor. These will expect no errors.
///
/// Example usage:
/// ```rust
/// // Create a testing context
/// let testing_context = setup_testing_context(//arguments);
/// let testing_engine = TestingEngine::new(testing_context).await;
/// let instruction_triggers = vec![
///     InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
///     InstructionTrigger::CreateCctpRouterEndpoints(CreateCctpRouterEndpointsInstructionConfig::default()),
///     InstructionTrigger::InitializeFastMarketOrderShim(InitializeFastMarketOrderShimInstructionConfig::default()),
///     InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
///     InstructionTrigger::ImproveOfferShimless(ImproveOfferInstructionConfig::default()),
///     InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig{
///         expected_error: Some(ExpectedError{
///             instruction_index: 0,
///             error_code: 1337,
///             error_message: String::from("LEET error message"),
///         }),
///     }),
/// ];
/// testing_engine.execute(instruction_triggers).await;
/// ```
pub struct TestingEngine {
    pub testing_context: TestingContext,
}

impl TestingEngine {
    pub async fn new(testing_context: TestingContext) -> Self {
        Self { testing_context }
    }

    /// Executes a chain of instruction triggers
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    /// * `instruction_chain` - The chain of instruction triggers to execute
    pub async fn execute(
        &self,
        test_context: &mut ProgramTestContext,
        execution_chain: impl Into<ExecutionChain>,
        initial_state: Option<TestingEngineState>,
    ) -> TestingEngineState {
        let mut current_state = initial_state.unwrap_or_else(|| self.create_initial_state());
        let execution_chain = execution_chain.into();
        self.verify_triggers(&execution_chain);

        for trigger in execution_chain.iter() {
            current_state = self
                .execute_trigger(test_context, &current_state, trigger)
                .await;
        }
        current_state
    }

    /// Verifies that the shimmode corresponds to the instruction chain
    fn verify_triggers(&self, execution_chain: &ExecutionChain) {
        // If any shim instructions are present, make sure that shim mode is set to VerifyAndPostSignature
        if execution_chain
            .instruction_triggers()
            .iter()
            .any(|trigger| trigger.is_shim())
        {
            assert_eq!(
                self.testing_context.shim_mode,
                ShimMode::VerifyAndPostSignature,
                "Shim mode is not set to VerifyAndPostSignature, and a shim instruction trigger is present"
            );
        }
    }

    /// Executes an instruction trigger and returns the updated testing engine state
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    /// * `current_state` - The current state of the testing engine
    /// * `trigger` - The instruction trigger to execute
    async fn execute_trigger(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        trigger: &ExecutionTrigger,
    ) -> TestingEngineState {
        match trigger {
            ExecutionTrigger::Instruction(trigger) => match **trigger {
                InstructionTrigger::InitializeProgram(ref config) => {
                    self.initialize_program(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::CreateCctpRouterEndpoints(ref config) => {
                    self.create_cctp_router_endpoints(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::InitializeFastMarketOrderShim(ref config) => {
                    self.create_fast_market_order_account(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::CloseFastMarketOrderShim(ref config) => {
                    self.close_fast_market_order_account(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::SetPauseCustodian(ref config) => {
                    self.set_pause_custodian(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PlaceInitialOfferShimless(ref config) => {
                    self.place_initial_offer_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PlaceInitialOfferShim(ref config) => {
                    self.place_initial_offer_shimful(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::ImproveOfferShimless(ref config) => {
                    self.improve_offer_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::ExecuteOrderShim(ref config) => {
                    self.execute_order_shimful(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::ExecuteOrderShimless(ref config) => {
                    self.execute_order_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PrepareOrderShim(ref config) => {
                    self.prepare_order_shim(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PrepareOrderShimless(ref config) => {
                    self.prepare_order_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::SettleAuction(ref config) => {
                    self.settle_auction(test_context, current_state, config)
                        .await
                }
            },
            ExecutionTrigger::Verification(trigger) => match **trigger {
                VerificationTrigger::VerifyAuctionState(expected_to_succeed) => {
                    self.verify_auction_state(test_context, current_state, expected_to_succeed)
                        .await
                }
                VerificationTrigger::VerifyBalances(ref config) => {
                    self.verify_balances(test_context, current_state, config)
                        .await
                }
            },
            ExecutionTrigger::CombinationTrigger(trigger) => match **trigger {
                CombinationTrigger::CreateFastMarketOrderAndPlaceInitialOffer(ref configs) => {
                    let create_fast_market_order_config =
                        configs.create_fast_market_order_config.as_ref().unwrap();
                    let place_initial_offer_config =
                        configs.place_initial_offer_config.as_ref().unwrap();
                    self.create_fast_market_order_and_place_initial_offer(
                        test_context,
                        current_state,
                        create_fast_market_order_config,
                        place_initial_offer_config,
                    )
                    .await
                }
            },
        }
    }

    // --------------------------------------------------------------------------------------------
    // Instruction trigger functions
    // --------------------------------------------------------------------------------------------

    /// Creates the initial state for the testing engine
    pub fn create_initial_state(&self) -> TestingEngineState {
        let fixture_accounts = self
            .testing_context
            .fixture_accounts
            .clone()
            .expect("Failed to get fixture accounts");
        let vaas: TestVaaPairs = self.testing_context.vaa_pairs.clone();
        let transfer_direction = self.testing_context.transfer_direction;
        TestingEngineState::Uninitialized(BaseState {
            fixture_accounts,
            vaas,
            transfer_direction,
        })
    }

    /// Instruction trigger function for initializing the program
    async fn initialize_program(
        &self,
        test_context: &mut ProgramTestContext,
        initial_state: &TestingEngineState,
        config: &InitializeInstructionConfig,
    ) -> TestingEngineState {
        initialize_program(&self.testing_context, test_context, initial_state, config).await
    }

    /// Instruction trigger function for creating cctp router endpoints
    async fn create_cctp_router_endpoints(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &CreateCctpRouterEndpointsInstructionConfig,
    ) -> TestingEngineState {
        // Make sure testing state is at least initialized
        let initialized_state = current_state
            .initialized()
            .expect("Testing state is not initialized");
        let custodian_address = initialized_state.custodian_address;
        let testing_actors = &self.testing_context.testing_actors;
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| testing_actors.owner.keypair());
        let admin_owner_or_assistant = config
            .admin_owner_or_assistant
            .clone()
            .unwrap_or_else(|| testing_actors.owner.keypair());
        let result = create_all_router_endpoints_test(
            &self.testing_context,
            test_context,
            &payer_signer,
            custodian_address,
            admin_owner_or_assistant,
            config.chains.clone(),
        )
        .await;
        TestingEngineState::RouterEndpointsCreated {
            base: current_state.base().clone(),
            initialized: initialized_state.clone(),
            router_endpoints: RouterEndpointsState { endpoints: result },
        }
    }

    /// Instruction trigger function for creating a fast market order account
    async fn create_fast_market_order_account(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &InitializeFastMarketOrderShimInstructionConfig,
    ) -> TestingEngineState {
        initialize_fast_market_order_shimful(
            &self.testing_context,
            test_context,
            config.expected_error(),
            current_state,
            config,
        )
        .await
    }

    /// Instruction trigger function for pausing the custodian
    async fn set_pause_custodian(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &SetPauseCustodianInstructionConfig,
    ) -> TestingEngineState {
        let owner_or_assistant = config.payer_signer.clone().unwrap_or_else(|| {
            self.testing_context
                .testing_actors
                .owner_assistant
                .keypair()
        });
        let is_paused = config.is_paused;
        let testing_context = &self.testing_context;
        shimless::pause_custodian::set_pause(
            test_context,
            testing_context,
            current_state,
            &owner_or_assistant,
            config.expected_error(),
            is_paused,
        )
        .await
    }

    /// Instruction trigger function for closing a fast market order account
    async fn close_fast_market_order_account(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &CloseFastMarketOrderShimInstructionConfig,
    ) -> TestingEngineState {
        // Get the fast market order account from the current state. If it is not present, panic
        let fast_market_order_account = config.fast_market_order_address.unwrap_or_else(|| {
            current_state
                .fast_market_order()
                .expect("Fast market order account not found")
                .fast_market_order_address
        });
        let close_account_refund_recipient = config
            .close_account_refund_recipient_keypair
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.solvers[0].keypair());

        shimful::fast_market_order_shim::close_fast_market_order_fallback(
            &self.testing_context,
            test_context,
            &close_account_refund_recipient,
            &fast_market_order_account,
            config.expected_error(),
        )
        .await;

        TestingEngineState::FastMarketOrderClosed {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().cloned(),
            auction_state: current_state.auction_state().clone(),
            fast_market_order: current_state.fast_market_order().cloned(),
            order_prepared: current_state.order_prepared().cloned(),
            auction_accounts: current_state.auction_accounts().cloned(),
            order_executed: current_state.order_executed().cloned(),
        }
    }

    /// Instruction trigger function for placing an initial offer
    async fn place_initial_offer_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PlaceInitialOfferInstructionConfig,
    ) -> TestingEngineState {
        assert!(
            current_state.router_endpoints().is_some(),
            "Router endpoints are not created"
        );
        shimless::make_offer::place_initial_offer_shimless(
            &self.testing_context,
            test_context,
            current_state,
            config,
        )
        .await
    }

    /// Instruction trigger function for improving an offer
    async fn improve_offer_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &ImproveOfferInstructionConfig,
    ) -> TestingEngineState {
        shimless::make_offer::improve_offer(
            &self.testing_context,
            test_context,
            current_state,
            config,
        )
        .await
    }

    /// Instruction trigger function for placing an initial offer
    async fn place_initial_offer_shimful(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PlaceInitialOfferInstructionConfig,
    ) -> TestingEngineState {
        shimful::shims_make_offer::place_initial_offer_shimful(
            &self.testing_context,
            test_context,
            current_state,
            config,
            config.expected_error(),
        )
        .await
    }

    /// Instruction trigger function for executing an order
    async fn execute_order_shimful(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &ExecuteOrderInstructionConfig,
    ) -> TestingEngineState {
        shimful::shims_execute_order::execute_order_shimful(
            &self.testing_context,
            test_context,
            current_state,
            config,
        )
        .await
    }

    /// Instruction trigger function for executing an order
    async fn execute_order_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &ExecuteOrderInstructionConfig,
    ) -> TestingEngineState {
        let auction_config_address = current_state
            .auction_config_address()
            .expect("Auction config address not found");
        let router_endpoints = current_state
            .router_endpoints()
            .expect("Router endpoints are not created");
        let actor = config
            .actor_enum
            .get_actor(&self.testing_context.testing_actors);
        let custodian_address = current_state
            .custodian_address()
            .expect("Custodian address not found");
        let auction_accounts = AuctionAccounts::new(
            Some(
                current_state
                    .get_test_vaa_pair(config.vaa_index)
                    .fast_transfer_vaa
                    .get_vaa_pubkey(),
            ),
            actor.clone(),
            current_state.close_account_refund_recipient(),
            auction_config_address,
            &router_endpoints.endpoints,
            custodian_address,
            current_state.spl_token_enum().unwrap(),
            current_state.base().transfer_direction,
        );
        shimless::execute_order::execute_order_shimless(
            &self.testing_context,
            test_context,
            current_state,
            config,
            &auction_accounts,
        )
        .await
    }

    /// Instruction trigger function for preparing an order
    async fn prepare_order_shim(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PrepareOrderResponseInstructionConfig,
    ) -> TestingEngineState {
        shimful::shims_prepare_order_response::prepare_order_response_cctp_shimful(
            &self.testing_context,
            test_context,
            config,
            current_state,
        )
        .await
    }

    /// Instruction trigger function for preparing an order
    async fn prepare_order_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PrepareOrderResponseInstructionConfig,
    ) -> TestingEngineState {
        shimless::prepare_order_response::prepare_order_response(
            &self.testing_context,
            test_context,
            config,
            current_state,
        )
        .await
    }

    /// Instruction trigger function for settling an auction
    async fn settle_auction(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &SettleAuctionInstructionConfig,
    ) -> TestingEngineState {
        shimless::settle_auction::settle_auction_complete(
            &self.testing_context,
            current_state,
            test_context,
            config,
            config.expected_error(),
        )
        .await
    }

    // --------------------------------------------------------------------------------------------
    // Verification trigger functions
    // --------------------------------------------------------------------------------------------

    async fn verify_auction_state(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        expected_to_succeed: bool,
    ) -> TestingEngineState {
        let auction_state = current_state
            .auction_state()
            .get_active_auction()
            .expect("Active auction state expected");
        let was_success = auction_state
            .verify_auction(&self.testing_context, test_context)
            .await
            .is_ok();
        assert_eq!(was_success, expected_to_succeed);
        current_state.clone()
    }

    async fn verify_balances(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &VerifyBalancesConfig,
    ) -> TestingEngineState {
        let previous_state_balances = &config.previous_state_balances;
        let balances = self.testing_context.get_balances(test_context).await;
        let balance_changes = config
            .get_balance_changes(test_context, current_state)
            .await;
        let mut is_error = false;
        for (actor, balance_change) in balance_changes.iter() {
            if let Some(closed_token_account_enums) = &config.closed_token_account_enums {
                if closed_token_account_enums.contains(actor) {
                    continue;
                }
            }
            let balance = balances.get(actor).unwrap();
            let previous_balance = previous_state_balances.get(actor).unwrap();
            if balance.usdc != saturating_add_signed(previous_balance.usdc, balance_change.usdc) {
                is_error = true;
                println!("USDC balance mismatch for actor {:?}", actor);
                println!("Expected balance change: {:?}", balance_change.usdc);
                println!(
                    "Actual balance change: {:?}",
                    balance.usdc.saturating_sub(previous_balance.usdc)
                );
            }
            if balance.usdt != saturating_add_signed(previous_balance.usdt, balance_change.usdt) {
                is_error = true;
                println!("USDT balance mismatch for actor {:?}", actor);
                println!("Expected balance change: {:?}", balance_change.usdt);
                println!(
                    "Actual balance change: {:?}",
                    balance.usdt.saturating_sub(previous_balance.usdt)
                );
            }
        }
        if is_error {
            panic!("Balance mismatch");
        }
        current_state.clone()
    }

    // --------------------------------------------------------------------------------------------
    // Combination trigger functions
    // --------------------------------------------------------------------------------------------

    async fn create_fast_market_order_and_place_initial_offer(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        create_fast_market_order_config: &InitializeFastMarketOrderShimInstructionConfig,
        place_initial_offer_config: &PlaceInitialOfferInstructionConfig,
    ) -> TestingEngineState {
        let program_id = &self.testing_context.get_matching_engine_program_id();
        let test_vaa_pair =
            current_state.get_test_vaa_pair(create_fast_market_order_config.vaa_index);
        let fast_transfer_vaa = test_vaa_pair.fast_transfer_vaa.clone();
        let fast_market_order = create_fast_market_order_state_from_vaa_data(
            &fast_transfer_vaa.vaa_data,
            create_fast_market_order_config
                .close_account_refund_recipient
                .unwrap_or_else(|| self.testing_context.testing_actors.solvers[0].pubkey()),
        );
        let create_fast_market_order_payer_signer = create_fast_market_order_config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.payer_signer.clone());
        let guardian_signature_info = create_guardian_signatures(
            &self.testing_context,
            test_context,
            &create_fast_market_order_payer_signer,
            &fast_transfer_vaa.vaa_data,
            &self.testing_context.get_wormhole_program_id(),
            None,
        )
        .await
        .expect("Failed to create guardian signatures");
        let (fast_market_order_account, fast_market_order_bump) = Pubkey::find_program_address(
            &[
                FastMarketOrder::SEED_PREFIX,
                &fast_market_order.digest(),
                &fast_market_order.close_account_refund_recipient.as_ref(),
            ],
            program_id,
        );
        let create_fast_market_order_instruction = initialize_fast_market_order_shimful_instruction(
            &create_fast_market_order_payer_signer,
            program_id,
            fast_market_order,
            &guardian_signature_info,
        );

        let place_initial_offer_instruction = place_initial_offer_shimful_instruction(
            &self.testing_context,
            test_context,
            current_state,
            place_initial_offer_config,
        )
        .await;
        let place_initial_offer_payer_signer = place_initial_offer_config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.payer_signer.clone());
        let transaction = self
            .testing_context
            .create_transaction(
                test_context,
                &[
                    create_fast_market_order_instruction,
                    place_initial_offer_instruction,
                ],
                Some(&place_initial_offer_payer_signer.pubkey()),
                &[&place_initial_offer_payer_signer],
                None,
                None,
            )
            .await;
        let actor_usdc_balance_before = place_initial_offer_config
            .actor
            .get_actor(&self.testing_context.testing_actors)
            .get_token_account_balance(test_context, &place_initial_offer_config.spl_token_enum)
            .await;
        let place_initial_offer_accounts = &PlaceInitialOfferShimfulAccounts::new(
            &self.testing_context,
            current_state,
            place_initial_offer_config,
        );
        self.testing_context
            .execute_and_verify_transaction(test_context, transaction, None)
            .await;
        let fast_market_order_created_state = TestingEngineState::FastMarketOrderAccountCreated {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().cloned(),
            fast_market_order: FastMarketOrderAccountCreatedState {
                fast_market_order_address: fast_market_order_account,
                fast_market_order_bump,
                fast_market_order,
                close_account_refund_recipient: fast_market_order.close_account_refund_recipient,
            },
            guardian_set_state: GuardianSetState {
                guardian_set_address: guardian_signature_info.guardian_set_pubkey,
                guardian_signatures_address: guardian_signature_info.guardian_signatures_pubkey,
            },
            auction_state: current_state.auction_state().clone(),
            auction_accounts: current_state.auction_accounts().cloned(),
            order_prepared: current_state.order_prepared().cloned(),
        };
        evaluate_place_initial_offer_shimful_state(
            &self.testing_context,
            test_context,
            &fast_market_order_created_state,
            place_initial_offer_config,
            actor_usdc_balance_before,
            place_initial_offer_accounts,
        )
        .await
    }

    // --------------------------------------------------------------------------------------------
    // Helper functions for manipulating the state
    // --------------------------------------------------------------------------------------------

    pub async fn make_auction_passed_penalty_period(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        slots_after_expiry: u64,
    ) {
        let active_auction_state = current_state
            .auction_state()
            .get_active_auction()
            .expect("Active auction state expected");
        let auction_expiration_slot = active_auction_state
            .get_auction_expiration_slot(test_context)
            .await;
        let target_slot = auction_expiration_slot + slots_after_expiry;
        fast_forward_slots(test_context, target_slot).await;
    }

    pub async fn make_auction_passed_grace_period(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        slots_after_grace_period: u64,
    ) {
        let active_auction_state = current_state
            .auction_state()
            .get_active_auction()
            .expect("Active auction state expected");
        let auction_grace_period_slot = active_auction_state
            .get_auction_grace_period_slot(test_context)
            .await;
        let target_slot = auction_grace_period_slot + slots_after_grace_period;
        fast_forward_slots(test_context, target_slot).await;
    }

    pub async fn make_fast_transfer_vaa_expired(
        &self,
        test_context: &mut ProgramTestContext,
        seconds_after_expiry: i64,
    ) {
        self.testing_context
            .make_fast_transfer_vaa_expired(test_context, seconds_after_expiry)
            .await;
    }

    pub async fn close_token_account(
        &self,
        test_context: &mut ProgramTestContext,
        actor_enum: &TestingActorEnum,
        spl_token_enum: &SplTokenEnum,
    ) {
        self.testing_context
            .testing_actors
            .get_actor(actor_enum)
            .close_token_account(test_context, spl_token_enum)
            .await;
    }
}

/// Fast forwards the slot in the test context
///
/// # Arguments
///
/// * `test_context` - The test context
/// * `num_slots` - The number of slots to fast forward
pub async fn fast_forward_slots(test_context: &mut ProgramTestContext, num_slots: u64) {
    // Get the current slot
    let mut current_slot = test_context.banks_client.get_root_slot().await.unwrap();

    let target_slot = current_slot.saturating_add(num_slots);
    while current_slot < target_slot {
        // Warp to the next slot - note we need to borrow_mut() here
        test_context
            .warp_to_slot(current_slot.saturating_add(1))
            .expect("Failed to warp to slot");
        current_slot = current_slot.saturating_add(1);
    }

    // Optionally, process a transaction to ensure the new slot is recognized
    let recent_blockhash = test_context.last_blockhash;
    let payer = test_context.payer.pubkey();
    let tx = Transaction::new_signed_with_payer(
        &[],
        Some(&payer),
        &[&test_context.payer],
        recent_blockhash,
    );

    test_context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("Failed to process transaction after warping");

    println!("Fast forwarded {} slots", num_slots);
}

#[allow(clippy::cast_sign_loss)]
fn saturating_add_signed(unsigned: u64, signed: i32) -> u64 {
    if signed >= 0 {
        unsigned.saturating_add(signed as u64)
    } else {
        unsigned.saturating_sub(signed.unsigned_abs() as u64)
    }
}
