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
    create_fast_market_order_state_from_vaa_data, initialise_fast_market_order_fallback,
};
use crate::shimful::verify_shim::create_guardian_signatures;
use crate::shimless;
use crate::testing_engine::setup::ShimMode;
use crate::utils::auction::AuctionState;
use crate::utils::token_account::SplTokenEnum;
use crate::utils::vaa::TestVaaPairs;
use crate::utils::{
    auction::{
        AuctionAccounts,
        // AuctionState
    },
    router::create_all_router_endpoints_test,
};
use anchor_lang::prelude::*;

pub enum InstructionTrigger {
    InitializeProgram(InitializeInstructionConfig),
    CreateCctpRouterEndpoints(CreateCctpRouterEndpointsInstructionConfig),
    InitializeFastMarketOrderShim(InitializeFastMarketOrderShimInstructionConfig),
    PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig),
    PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig),
    ImproveOfferShimless(ImproveOfferInstructionConfig),
    ExecuteOrderShimless(ExecuteOrderInstructionConfig),
    ExecuteOrderShim(ExecuteOrderInstructionConfig),
    PrepareOrderShimless(PrepareOrderInstructionConfig),
    PrepareOrderShim(PrepareOrderInstructionConfig),
    SettleAuction(SettleAuctionInstructionConfig),
    CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig),
}

pub enum VerificationTrigger {
    // Verify that the auction state is as expected (bool is expected to succeed)
    VerifyAuctionState(bool),
}

pub enum ExecutionTrigger {
    Instruction(InstructionTrigger),
    Verification(VerificationTrigger),
}

impl From<InstructionTrigger> for ExecutionTrigger {
    fn from(trigger: InstructionTrigger) -> Self {
        ExecutionTrigger::Instruction(trigger)
    }
}

impl From<VerificationTrigger> for ExecutionTrigger {
    fn from(trigger: VerificationTrigger) -> Self {
        ExecutionTrigger::Verification(trigger)
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
    pub fn instruction_triggers(&self) -> Vec<&InstructionTrigger> {
        self.iter()
            .filter_map(|trigger| match trigger {
                ExecutionTrigger::Instruction(trigger) => Some(trigger),
                _ => None,
            })
            .collect()
    }
}
impl From<Vec<InstructionTrigger>> for ExecutionChain {
    fn from(triggers: Vec<InstructionTrigger>) -> Self {
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
            ExecutionTrigger::Instruction(trigger) => match trigger {
                InstructionTrigger::InitializeProgram(config) => {
                    self.initialize_program(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::CreateCctpRouterEndpoints(config) => {
                    self.create_cctp_router_endpoints(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::InitializeFastMarketOrderShim(config) => {
                    self.create_fast_market_order_account(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::CloseFastMarketOrderShim(config) => {
                    self.close_fast_market_order_account(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PlaceInitialOfferShimless(config) => {
                    self.place_initial_offer_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PlaceInitialOfferShim(config) => {
                    self.place_initial_offer_shim(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::ImproveOfferShimless(config) => {
                    self.improve_offer_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::ExecuteOrderShim(config) => {
                    self.execute_order_shim(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::ExecuteOrderShimless(config) => {
                    self.execute_order_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PrepareOrderShim(config) => {
                    self.prepare_order_shim(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::PrepareOrderShimless(config) => {
                    self.prepare_order_shimless(test_context, current_state, config)
                        .await
                }
                InstructionTrigger::SettleAuction(config) => {
                    self.settle_auction(test_context, current_state, config)
                        .await
                }
            },
            ExecutionTrigger::Verification(trigger) => match trigger {
                VerificationTrigger::VerifyAuctionState(expected_to_succeed) => {
                    self.verify_auction_state(test_context, current_state, *expected_to_succeed)
                        .await
                }
            },
        }
    }

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
        let auction_parameters_config = config.auction_parameters_config.clone();
        let expected_error = config.expected_error();
        let expected_log_messages = config.expected_log_messages();

        let (result, owner_pubkey, owner_assistant_pubkey, fee_recipient_token_account) = {
            let result = shimless::initialize::initialize_program(
                &self.testing_context,
                test_context,
                auction_parameters_config,
                expected_error,
                expected_log_messages,
            )
            .await;

            let testing_actors = &self.testing_context.testing_actors;
            (
                result,
                testing_actors.owner.pubkey(),
                testing_actors.owner_assistant.pubkey(),
                testing_actors
                    .fee_recipient
                    .token_account_address(&SplTokenEnum::Usdc)
                    .unwrap(),
            )
        };

        if expected_error.is_none() {
            let initialize_fixture = result.expect("Failed to initialize program");
            initialize_fixture.verify_custodian(
                owner_pubkey,
                owner_assistant_pubkey,
                fee_recipient_token_account,
            );

            let auction_config_address = initialize_fixture.get_auction_config_address();
            return TestingEngineState::Initialized {
                base: initial_state.base().clone(),
                initialized: InitializedState {
                    auction_config_address,
                    custodian_address: initialize_fixture.get_custodian_address(),
                },
            };
        }
        initial_state.clone()
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
        let first_test_vaa_pair = current_state.get_first_test_vaa_pair();
        let fast_transfer_vaa = first_test_vaa_pair.fast_transfer_vaa.clone();
        let fast_market_order = create_fast_market_order_state_from_vaa_data(
            &fast_transfer_vaa.vaa_data,
            config
                .close_account_refund_recipient
                .unwrap_or_else(|| self.testing_context.testing_actors.solvers[0].pubkey()),
        );
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.owner.keypair());
        let guardian_signature_info = create_guardian_signatures(
            &self.testing_context,
            test_context,
            &payer_signer,
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
                &fast_market_order.close_account_refund_recipient,
            ],
            &self.testing_context.get_matching_engine_program_id(),
        );

        initialise_fast_market_order_fallback(
            &self.testing_context,
            test_context,
            &payer_signer,
            fast_market_order,
            &guardian_signature_info,
            config.expected_error(),
        )
        .await;

        if config.expected_error.is_none() {
            TestingEngineState::FastMarketOrderAccountCreated {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().cloned(),
                fast_market_order: FastMarketOrderAccountCreatedState {
                    fast_market_order_address: fast_market_order_account,
                    fast_market_order_bump,
                    fast_market_order,
                    close_account_refund_recipient: Pubkey::try_from_slice(
                        &fast_market_order.close_account_refund_recipient,
                    )
                    .unwrap(),
                },
                guardian_set_state: GuardianSetState {
                    guardian_set_address: guardian_signature_info.guardian_set_pubkey,
                    guardian_signatures_address: guardian_signature_info.guardian_signatures_pubkey,
                },
                auction_state: current_state.auction_state().clone(),
                auction_accounts: current_state.auction_accounts().cloned(),
            }
        } else {
            current_state.clone()
        }
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
        }
    }
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

        let initial_offer_placed_state = shimless::make_offer::place_initial_offer_shimless(
            &self.testing_context,
            test_context,
            current_state,
            config,
        )
        .await;
        if config.expected_error().is_none() {
            let initial_offer_placed_state = initial_offer_placed_state.unwrap();
            let auction_state = initial_offer_placed_state.auction_state;
            let auction_accounts = initial_offer_placed_state.auction_accounts;
            auction_state
                .get_active_auction()
                .unwrap()
                .verify_auction(&self.testing_context, test_context)
                .await
                .expect("Could not verify auction state");
            return TestingEngineState::InitialOfferPlaced {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state,
                auction_accounts,
            };
        }
        current_state.clone()
    }

    /// Instruction trigger function for improving an offer
    async fn improve_offer_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &ImproveOfferInstructionConfig,
    ) -> TestingEngineState {
        let expected_error = config.expected_error();
        let actor = config.actor.get_actor(&self.testing_context.testing_actors);
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.owner.keypair());
        let new_auction_state = shimless::make_offer::improve_offer(
            &self.testing_context,
            test_context,
            &actor,
            config,
            &payer_signer,
            current_state.auction_state(),
            expected_error,
        )
        .await;
        if expected_error.is_none() {
            return TestingEngineState::OfferImproved {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state: new_auction_state,
                auction_accounts: current_state.auction_accounts().cloned(),
            };
        }
        current_state.clone()
    }

    /// Instruction trigger function for placing an initial offer
    async fn place_initial_offer_shim(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PlaceInitialOfferInstructionConfig,
    ) -> TestingEngineState {
        let place_initial_offer_shim_fixture =
            shimful::shims_make_offer::place_initial_offer_fallback(
                &self.testing_context,
                test_context,
                current_state,
                config,
                config.expected_error(),
            )
            .await;
        if config.expected_error.is_none() {
            let initial_offer_placed_state = place_initial_offer_shim_fixture.unwrap();
            let active_auction_state = initial_offer_placed_state
                .auction_state
                .get_active_auction()
                .unwrap();
            active_auction_state
                .verify_auction(&self.testing_context, test_context)
                .await
                .expect("Could not verify auction");
            let auction_accounts = initial_offer_placed_state.auction_accounts;
            return TestingEngineState::InitialOfferPlaced {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state: initial_offer_placed_state.auction_state,
                auction_accounts,
            };
        }
        current_state.clone()
    }

    /// Instruction trigger function for executing an order
    async fn execute_order_shim(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &ExecuteOrderInstructionConfig,
    ) -> TestingEngineState {
        let result = shimful::shims_execute_order::execute_order_fallback_test(
            &self.testing_context,
            test_context,
            current_state,
            config,
        )
        .await;
        if config.expected_error.is_none() {
            let auction_accounts = current_state
                .auction_accounts()
                .expect("Auction accounts not found");
            let order_executed_fallback_fixture = result.unwrap();
            let order_executed_state = OrderExecutedState {
                cctp_message: order_executed_fallback_fixture.cctp_message,
                post_message_sequence: Some(order_executed_fallback_fixture.post_message_sequence),
                post_message_message: Some(order_executed_fallback_fixture.post_message_message),
            };
            TestingEngineState::OrderExecuted {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state: current_state.auction_state().clone(),
                order_executed: order_executed_state,
                auction_accounts: auction_accounts.clone(),
            }
        } else {
            current_state.clone()
        }
    }

    /// Instruction trigger function for executing an order
    async fn execute_order_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &ExecuteOrderInstructionConfig,
    ) -> TestingEngineState {
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.owner.keypair());
        let auction_config_address = current_state
            .auction_config_address()
            .expect("Auction config address not found");
        let router_endpoints = current_state
            .router_endpoints()
            .expect("Router endpoints are not created");
        let solver = self.testing_context.testing_actors.solvers[config.solver_index].clone();
        let custodian_address = current_state
            .custodian_address()
            .expect("Custodian address not found");
        let auction_accounts = AuctionAccounts::new(
            Some(
                current_state
                    .get_first_test_vaa_pair()
                    .fast_transfer_vaa
                    .get_vaa_pubkey(),
            ),
            solver.actor.clone(),
            current_state.close_account_refund_recipient(),
            auction_config_address,
            &router_endpoints.endpoints,
            custodian_address,
            current_state.spl_token_enum().unwrap(),
            current_state.base().transfer_direction,
        );
        let result = shimless::execute_order::execute_order_shimless_test(
            &self.testing_context,
            test_context,
            &auction_accounts,
            current_state.auction_state(),
            &payer_signer,
            config.expected_error(),
        )
        .await;
        if config.expected_error.is_none() {
            let execute_order_fixture = result.unwrap();
            let order_executed_state = OrderExecutedState {
                cctp_message: execute_order_fixture.cctp_message,
                post_message_sequence: None,
                post_message_message: None,
            };
            TestingEngineState::OrderExecuted {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state: current_state.auction_state().clone(),
                order_executed: order_executed_state,
                auction_accounts: auction_accounts.clone(),
            }
        } else {
            current_state.clone()
        }
    }

    /// Instruction trigger function for preparing an order
    async fn prepare_order_shim(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PrepareOrderInstructionConfig,
    ) -> TestingEngineState {
        let auction_accounts = current_state
            .auction_accounts()
            .expect("Auction accounts not found");

        let deposit_vaa = current_state.get_first_test_vaa_pair().deposit_vaa.clone();
        let deposit_vaa_data = deposit_vaa.get_vaa_data();
        let deposit = deposit_vaa
            .payload_deserialized
            .clone()
            .unwrap()
            .get_deposit()
            .unwrap();

        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.owner.keypair());

        let result = shimful::shims_prepare_order_response::prepare_order_response_test(
            &self.testing_context,
            test_context,
            &payer_signer,
            deposit_vaa_data,
            current_state,
            &auction_accounts.to_router_endpoint,
            &auction_accounts.from_router_endpoint,
            &deposit,
            config.expected_error(),
        )
        .await;
        if config.expected_error.is_none() {
            let prepare_order_response_fixture = result.unwrap();
            let order_prepared_state = OrderPreparedState {
                prepared_order_address: prepare_order_response_fixture.prepared_order_response,
                prepared_custody_token: prepare_order_response_fixture.prepared_custody_token,
            };
            TestingEngineState::OrderPrepared {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state: current_state.auction_state().clone(),
                order_prepared: order_prepared_state,
                auction_accounts: auction_accounts.clone(),
            }
        } else {
            current_state.clone()
        }
    }

    /// Instruction trigger function for preparing an order
    async fn prepare_order_shimless(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PrepareOrderInstructionConfig,
    ) -> TestingEngineState {
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.owner.keypair());
        let auction_accounts = current_state
            .auction_accounts()
            .expect("Auction accounts not found");
        let solver_token_account = self
            .testing_context
            .testing_actors
            .solvers
            .get(config.solver_index)
            .expect("Solver not found at index")
            .token_account_address()
            .expect("Token account does not exist for solver at index");
        let result = shimless::prepare_order_response::prepare_order_response(
            &self.testing_context,
            test_context,
            &payer_signer,
            current_state,
            &auction_accounts.to_router_endpoint,
            &auction_accounts.from_router_endpoint,
            &solver_token_account,
            config.expected_error(),
            config.expected_log_messages.as_ref(),
        )
        .await;
        if config.expected_error.is_none() {
            let prepare_order_response_fixture = result.unwrap();
            let order_prepared_state = OrderPreparedState {
                prepared_order_address: prepare_order_response_fixture.prepared_order_response,
                prepared_custody_token: prepare_order_response_fixture.prepared_custody_token,
            };
            TestingEngineState::OrderPrepared {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state: current_state.auction_state().clone(),
                order_prepared: order_prepared_state,
                auction_accounts: auction_accounts.clone(),
            }
        } else {
            current_state.clone()
        }
    }

    /// Instruction trigger function for settling an auction
    async fn settle_auction(
        &self,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &SettleAuctionInstructionConfig,
    ) -> TestingEngineState {
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| self.testing_context.testing_actors.owner.keypair());
        let order_prepared_state = current_state
            .order_prepared()
            .expect("Order prepared not found");
        let prepared_custody_token = order_prepared_state.prepared_custody_token;
        let prepared_order_response = order_prepared_state.prepared_order_address;
        let auction_state = shimless::settle_auction::settle_auction_complete(
            &self.testing_context,
            test_context,
            &payer_signer,
            current_state.auction_state(),
            &prepared_order_response,
            &prepared_custody_token,
            config.expected_error(),
        )
        .await;
        match auction_state {
            AuctionState::Settled => TestingEngineState::AuctionSettled {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                auction_state: current_state.auction_state().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                order_prepared: order_prepared_state.clone(),
                auction_accounts: current_state.auction_accounts().cloned(),
            },
            _ => current_state.clone(),
        }
    }

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
