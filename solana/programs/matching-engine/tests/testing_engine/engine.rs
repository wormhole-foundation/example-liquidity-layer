use matching_engine::state::FastMarketOrder;
use solana_sdk::transaction::VersionedTransaction;

use super::{config::*, state::*};
use crate::shimful;
use crate::shimful::fast_market_order_shim::{
    create_fast_market_order_state_from_vaa_data, initialise_fast_market_order_fallback_instruction,
};
use crate::shimful::verify_shim::create_guardian_signatures;
use crate::shimless;
use crate::utils::vaa::TestVaaPairs;
use crate::utils::{router::create_all_router_endpoints_test, setup::TestingContext};
use anchor_lang::prelude::*;

#[allow(dead_code)]
pub enum InstructionTrigger {
    InitializeProgram(InitializeInstructionConfig),
    CreateCctpRouterEndpoints(CreateCctpRouterEndpointsInstructionConfig),
    InitializeFastMarketOrderShim(InitializeFastMarketOrderShimInstructionConfig),
    CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig),
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
        Self {
            testing_context: testing_context,
        }
    }

    pub async fn execute(&self, instruction_chain: Vec<InstructionTrigger>) {
        let mut current_state = self.create_initial_state();

        for trigger in instruction_chain {
            current_state = self.execute_trigger(&current_state, &trigger).await;
        }
    }

    async fn execute_trigger(
        &self,
        current_state: &TestingEngineState,
        trigger: &InstructionTrigger,
    ) -> TestingEngineState {
        match trigger {
            InstructionTrigger::InitializeProgram(config) => {
                self.initialize_program(current_state, config).await
            }
            InstructionTrigger::CreateCctpRouterEndpoints(config) => {
                self.create_cctp_router_endpoints(current_state, config)
                    .await
            }
            InstructionTrigger::InitializeFastMarketOrderShim(config) => {
                self.create_fast_market_order_account(current_state, config)
                    .await
            }
            InstructionTrigger::CloseFastMarketOrderShim(config) => {
                self.close_fast_market_order_account(current_state, config)
                    .await
            }
        }
    }

    pub fn create_initial_state(&self) -> TestingEngineState {
        let fixture_accounts = self
            .testing_context
            .fixture_accounts
            .clone()
            .expect("Failed to get fixture accounts");
        let vaas: TestVaaPairs = self.testing_context.testing_state.vaas.clone();
        let transfer_direction = self.testing_context.testing_state.transfer_direction;
        TestingEngineState::Uninitialized(BaseState {
            fixture_accounts,
            vaas,
            transfer_direction,
        })
    }

    async fn initialize_program(
        &self,
        initial_state: &TestingEngineState,
        config: &InitializeInstructionConfig,
    ) -> TestingEngineState {
        let auction_parameters_config = config.auction_parameters_config.clone();
        let expected_error = config.expected_error.as_ref();

        let (result, owner_pubkey, owner_assistant_pubkey, fee_recipient_token_account) = {
            let result = shimless::initialize::initialize_program(
                &self.testing_context,
                auction_parameters_config,
                expected_error,
            )
            .await;

            let testing_actors = &self.testing_context.testing_actors;
            (
                result,
                testing_actors.owner.pubkey(),
                testing_actors.owner_assistant.pubkey(),
                testing_actors
                    .fee_recipient
                    .token_account_address()
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

    async fn create_cctp_router_endpoints(
        &self,
        current_state: &TestingEngineState,
        config: &CreateCctpRouterEndpointsInstructionConfig,
    ) -> TestingEngineState {
        // Make sure testing state is at least initialized
        let initialized_state = current_state
            .initialized()
            .expect("Testing state is not initialized");
        let custodian_address = initialized_state.custodian_address;
        let testing_actors = &self.testing_context.testing_actors;
        let result = create_all_router_endpoints_test(
            &self.testing_context,
            testing_actors.owner.pubkey(),
            custodian_address,
            testing_actors.owner.keypair(),
            config.chains.clone(),
        )
        .await;
        TestingEngineState::RouterEndpointsCreated {
            base: current_state.base().clone(),
            initialized: initialized_state.clone(),
            router_endpoints: RouterEndpointsState { endpoints: result },
        }
    }

    async fn create_fast_market_order_account(
        &self,
        current_state: &TestingEngineState,
        config: &InitializeFastMarketOrderShimInstructionConfig,
    ) -> TestingEngineState {
        let first_test_vaa_pair = current_state.get_first_test_vaa_pair();
        let fast_transfer_vaa = first_test_vaa_pair.fast_transfer_vaa.clone();
        let (fast_market_order, vaa_data) = create_fast_market_order_state_from_vaa_data(
            &fast_transfer_vaa.vaa_data,
            config
                .close_account_refund_recipient
                .unwrap_or(self.testing_context.testing_actors.solvers[0].pubkey()),
        );
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or(self.testing_context.testing_actors.owner.keypair());
        let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
            create_guardian_signatures(
                &self.testing_context.test_context,
                &payer_signer,
                &vaa_data,
                &self.testing_context.get_wormhole_program_id(),
                None,
            )
            .await;

        let (fast_market_order_account, fast_market_order_bump) = Pubkey::find_program_address(
            &[
                FastMarketOrder::SEED_PREFIX,
                &fast_market_order.digest(),
                &fast_market_order.close_account_refund_recipient,
            ],
            &self.testing_context.get_matching_engine_program_id(),
        );

        let initialise_fast_market_order_ix = initialise_fast_market_order_fallback_instruction(
            &payer_signer,
            &self.testing_context.get_matching_engine_program_id(),
            fast_market_order,
            guardian_set_pubkey,
            guardian_signatures_pubkey,
            guardian_set_bump,
        );

        let recent_blockhash = self.testing_context.test_context.borrow().last_blockhash;
        let transaction = solana_sdk::transaction::Transaction::new_signed_with_payer(
            &[initialise_fast_market_order_ix],
            Some(&self.testing_context.testing_actors.owner.pubkey()),
            &[&self.testing_context.testing_actors.owner.keypair()],
            recent_blockhash,
        );
        let versioned_transaction = VersionedTransaction::try_from(transaction)
            .expect("Failed to convert transaction to versioned transaction");
        self.testing_context
            .execute_and_verify_transaction(versioned_transaction, config.expected_error.as_ref())
            .await;
        if config.expected_error.is_none() {
            TestingEngineState::FastMarketOrderAccountCreated {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().cloned(),
                fast_market_order: FastMarketOrderAccountCreatedState {
                    fast_market_order_address: fast_market_order_account,
                    fast_market_order_bump: fast_market_order_bump,
                    fast_market_order: fast_market_order,
                },
                guardian_set_state: GuardianSetState {
                    guardian_set_address: guardian_set_pubkey,
                    guardian_signatures_address: guardian_signatures_pubkey,
                },
            }
        } else {
            current_state.clone()
        }
    }

    async fn close_fast_market_order_account(
        &self,
        current_state: &TestingEngineState,
        config: &CloseFastMarketOrderShimInstructionConfig,
    ) -> TestingEngineState {
        // Get the fast market order account from the current state. If it is not present, panic
        let fast_market_order_account = config.fast_market_order_address.unwrap_or(
            current_state
                .fast_market_order()
                .expect("Fast market order account not found")
                .fast_market_order_address,
        );
        let close_account_refund_recipient = config
            .close_account_refund_recipient_keypair
            .clone()
            .unwrap_or(self.testing_context.testing_actors.solvers[0].keypair());

        shimful::fast_market_order_shim::close_fast_market_order_fallback(
            &self.testing_context,
            &close_account_refund_recipient,
            &self.testing_context.get_matching_engine_program_id(),
            &fast_market_order_account,
            config.expected_error.as_ref(),
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
}
