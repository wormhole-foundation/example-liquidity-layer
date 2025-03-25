use matching_engine::state::FastMarketOrder;
use solana_sdk::transaction::VersionedTransaction;

use super::{config::*, state::*};
use crate::shimful::shims::{
    create_fast_market_order_state_from_vaa_data, create_guardian_signatures,
    initialise_fast_market_order_fallback_instruction,
};
use crate::utils::{
    auction::AuctionAccounts, router::create_all_router_endpoints_test, setup::TestingContext,
};
use crate::{shimless, utils::vaa::TestVaaPairs};
use anchor_lang::prelude::*;

#[allow(dead_code)]
pub enum InstructionTrigger {
    InitializeProgram(InitializeInstructionConfig),
    CreateCctpRouterEndpoints(CreateCctpRouterEndpointsInstructionConfig),
    InitializeFastMarketOrderShim(InitializeFastMarketOrderShimInstructionConfig),
    PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig),
    PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig),
    ImproveOfferShimless(ImproveOfferInstructionConfig),
    ExecuteOrderShimless,
    ExecuteOrderShim,
    PrepareOrderShimless,
    PrepareOrderShim,
    SettleAuction,
    CloseFastMarketOrderShim,
}

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
            InstructionTrigger::PlaceInitialOfferShimless(config) => {
                self.place_initial_offer_shimless(current_state, config)
                    .await
            }
            InstructionTrigger::InitializeFastMarketOrderShim(config) => {
                self.create_fast_market_order_account(current_state, config)
                    .await
            }
            InstructionTrigger::ImproveOfferShimless(config) => {
                self.improve_offer_shimless(current_state, config).await
            }
            _ => panic!("Not implemented yet"), // Not implemented yet
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
            config.close_account_refund_recipient,
        );
        let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
            create_guardian_signatures(
                &self.testing_context.test_context,
                &self.testing_context.testing_actors.owner.keypair(),
                &vaa_data,
                &BaseState::CORE_BRIDGE_PROGRAM_ID,
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
            &self.testing_context.testing_actors.owner.keypair(),
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
        let res = self
            .testing_context
            .test_context
            .borrow_mut()
            .banks_client
            .process_transaction(versioned_transaction)
            .await;
        if config.expected_error.is_none() {
            res.expect("Failed to initialise fast market order");
            TestingEngineState::FastMarketOrderAccountCreated {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: FastMarketOrderAccountCreatedState {
                    fast_market_order_address: fast_market_order_account,
                    fast_market_order_bump: fast_market_order_bump,
                },
            }
        } else {
            current_state.clone()
        }
    }
    async fn place_initial_offer_shimless(
        &self,
        current_state: &TestingEngineState,
        config: &PlaceInitialOfferInstructionConfig,
    ) -> TestingEngineState {
        assert!(
            current_state.router_endpoints().is_some(),
            "Router endpoints are not created"
        );
        let solver = self
            .testing_context
            .testing_actors
            .solvers
            .get(config.solver_index)
            .expect("Solver not found at index");
        let expected_error = config.expected_error.as_ref();
        let fast_vaa = &current_state
            .base()
            .vaas
            .get(0)
            .expect("Failed to get vaa pair")
            .fast_transfer_vaa;
        let fast_vaa_pubkey = fast_vaa.get_vaa_pubkey();
        let auction_config_address = current_state
            .initialized()
            .expect("Testing state is not initialized")
            .auction_config_address;
        let custodian_address = current_state
            .initialized()
            .expect("Testing state is not initialized")
            .custodian_address;
        let auction_accounts = AuctionAccounts::new(
            Some(fast_vaa_pubkey),
            solver.clone(),
            auction_config_address,
            &current_state
                .router_endpoints()
                .expect("Router endpoints are not created")
                .endpoints,
            custodian_address,
            self.testing_context.get_usdc_mint_address(),
            self.testing_context.testing_state.transfer_direction,
        );
        let auction_state = shimless::make_offer::place_initial_offer_shimless(
            &self.testing_context,
            &auction_accounts,
            fast_vaa,
            config.offer_price,
            self.testing_context.get_matching_engine_program_id(),
            expected_error,
        )
        .await;
        if expected_error.is_none() {
            auction_state
                .get_active_auction()
                .unwrap()
                .verify_initial_offer(&self.testing_context.test_context)
                .await;
            return TestingEngineState::InitialOfferPlaced {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state,
            };
        }
        current_state.clone()
    }

    async fn improve_offer_shimless(
        &self,
        current_state: &TestingEngineState,
        config: &ImproveOfferInstructionConfig,
    ) -> TestingEngineState {
        let expected_error = config.expected_error.as_ref();
        let solver = self
            .testing_context
            .testing_actors
            .solvers
            .get(config.solver_index)
            .expect("Solver not found at index");
        let offer_price = config.offer_price;
        let auction_config_address = current_state
            .auction_config_address()
            .expect("Auction config address not found");
        let new_auction_state = shimless::make_offer::improve_offer(
            &self.testing_context,
            self.testing_context.get_matching_engine_program_id(),
            solver.clone(),
            auction_config_address,
            offer_price,
            current_state.auction_state(),
            expected_error,
        )
        .await;
        if expected_error.is_none() {
            let auction_state = new_auction_state.unwrap();
            return TestingEngineState::OfferImproved {
                base: current_state.base().clone(),
                initialized: current_state.initialized().unwrap().clone(),
                router_endpoints: current_state.router_endpoints().unwrap().clone(),
                fast_market_order: current_state.fast_market_order().cloned(),
                auction_state,
            };
        }
        current_state.clone()
    }
}
