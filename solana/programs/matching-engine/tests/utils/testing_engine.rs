use std::{cell::RefCell, rc::Rc};

use crate::shimless::{
    initialize::{initialize_program, InitializeFixture},
    make_offer::{improve_offer, place_initial_offer_shimless},
};

use super::{
    auction::AuctionAccounts,
    router::{create_all_router_endpoints_test, TestRouterEndpoints},
    setup::TestingContext,
    testing_engine_configs::*,
};

#[allow(dead_code)]
pub enum InstructionTrigger {
    InitializeProgram(InitializeInstructionConfig),
    CreateCctpRouterEndpoints,
    InitializeFastMarketOrderShim(InitializeFastMarketOrderShimInstructionConfig),
    CloseFastMarketOrderShim,
    PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig),
    PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig),
    ImproveOfferShimless(ImproveOfferInstructionConfig),
    ExecuteOrderShimless,
    ExecuteOrderShim,
    PrepareOrderShimless,
    PrepareOrderShim,
    SettleAuction,
}

pub struct InstructionTriggerResults {
    pub initialize_program: Option<InitializeFixture>,
    pub create_cctp_router_endpoints: Option<TestRouterEndpoints>,
}

impl InstructionTriggerResults {
    pub fn new() -> Self {
        Self {
            initialize_program: None,
            create_cctp_router_endpoints: None,
        }
    }
}

pub struct TestingEngine {
    pub testing_context: Rc<RefCell<TestingContext>>,
    pub instruction_triggers: Vec<InstructionTrigger>,
    pub instruction_trigger_results: Rc<RefCell<InstructionTriggerResults>>,
}

impl TestingEngine {
    pub async fn new(
        testing_context: TestingContext,
        instruction_triggers: Vec<InstructionTrigger>,
    ) -> Self {
        Self {
            testing_context: Rc::new(RefCell::new(testing_context)),
            instruction_triggers,
            instruction_trigger_results: Rc::new(RefCell::new(InstructionTriggerResults::new())),
        }
    }

    pub async fn execute(&self) {
        for trigger in self.instruction_triggers.iter() {
            self.execute_trigger(trigger).await;
        }
    }

    async fn execute_trigger(&self, trigger: &InstructionTrigger) {
        match trigger {
            InstructionTrigger::InitializeProgram(config) => {
                self.instruction_trigger_results
                    .borrow_mut()
                    .initialize_program = self.initialize_program(config).await;
            }
            InstructionTrigger::CreateCctpRouterEndpoints => {
                self.instruction_trigger_results
                    .borrow_mut()
                    .create_cctp_router_endpoints = self.create_cctp_router_endpoints().await;
            }
            InstructionTrigger::PlaceInitialOfferShimless(config) => {
                self.place_initial_offer_shimless(config).await;
            }
            InstructionTrigger::ImproveOfferShimless(config) => {
                self.improve_offer_shimless(config).await;
            }
            _ => panic!("Not implemented yet"), // Not implemented yet
        }
    }

    async fn initialize_program(
        &self,
        config: &InitializeInstructionConfig,
    ) -> Option<InitializeFixture> {
        let auction_parameters_config = config.auction_parameters_config.clone();
        let expected_error = config.expected_error.as_ref();

        let (result, owner_pubkey, owner_assistant_pubkey, fee_recipient_token_account) = {
            let testing_context_ref = self.testing_context.borrow();
            let result = initialize_program(
                &testing_context_ref,
                auction_parameters_config,
                expected_error,
            )
            .await;

            let testing_actors = &testing_context_ref.testing_actors;
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
            self.testing_context
                .borrow_mut()
                .testing_state
                .program_state
                .initialize(auction_config_address);
            return Some(initialize_fixture);
        }
        None
    }

    async fn create_cctp_router_endpoints(&self) -> Option<TestRouterEndpoints> {
        let custodian_address = self
            .testing_context
            .borrow()
            .testing_state
            .program_state
            .get_custodian_address();
        let testing_actors = &self.testing_context.borrow().testing_actors;
        let result = create_all_router_endpoints_test(
            &self.testing_context.borrow(),
            testing_actors.owner.pubkey(),
            custodian_address,
            testing_actors.owner.keypair(),
        )
        .await;
        Some(result)
    }

    async fn place_initial_offer_shimless(&self, config: &PlaceInitialOfferInstructionConfig) {
        let solver =
            self.testing_context.borrow().testing_actors.solvers[config.solver_index].clone();
        let expected_error = config.expected_error.as_ref();
        let testing_context: &mut TestingContext = &mut *self.testing_context.borrow_mut();
        let fast_vaa = testing_context
            .get_vaa_pair(0)
            .expect("Failed to get vaa pair")
            .fast_transfer_vaa;
        let fast_vaa_pubkey = fast_vaa.get_vaa_pubkey();
        let custodian_address = testing_context
            .testing_state
            .program_state
            .get_custodian_address();
        let auction_config_address = testing_context
            .testing_state
            .auction_state
            .get_active_auction()
            .unwrap()
            .auction_config_address;

        let auction_accounts = AuctionAccounts::new(
            Some(fast_vaa_pubkey),
            solver,
            auction_config_address,
            self.instruction_trigger_results
                .borrow()
                .create_cctp_router_endpoints
                .as_ref()
                .unwrap(),
            custodian_address,
            testing_context.get_usdc_mint_address(),
            testing_context.testing_state.transfer_direction,
        );
        place_initial_offer_shimless(
            testing_context,
            &auction_accounts,
            fast_vaa,
            testing_context.get_matching_engine_program_id(),
            expected_error,
        )
        .await;
        if expected_error.is_none() {
            self.testing_context
                .borrow()
                .testing_state
                .auction_state
                .get_active_auction()
                .unwrap()
                .verify_initial_offer(&self.testing_context.borrow().test_context)
                .await;
        }
    }

    async fn improve_offer_shimless(&self, config: &ImproveOfferInstructionConfig) {
        let expected_error = config.expected_error.as_ref();
        let testing_context: &mut TestingContext = &mut *self.testing_context.borrow_mut();
        let solver =
            self.testing_context.borrow().testing_actors.solvers[config.solver_index].clone();
        let offer_price = config.offer_price;
        let auction_config_address = testing_context
            .testing_state
            .auction_state
            .get_active_auction()
            .unwrap()
            .auction_config_address;
        improve_offer(
            testing_context,
            testing_context.get_matching_engine_program_id(),
            solver,
            auction_config_address,
            offer_price,
            expected_error,
        )
        .await;
        // TODO: Implement check on improved offer auction state
        // auction_state
        //     .borrow()
        //     .verify_improved_offer(&testing_context.test_context)
        //     .await;
    }
}
