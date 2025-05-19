use crate::testing_engine::config::{
    ExpectedError, InstructionConfig, PlaceInitialOfferInstructionConfig,
};
use crate::testing_engine::state::{InitialOfferPlacedState, TestingEngineState};
use crate::utils::auction::AuctionAccounts;

use super::super::utils;
use crate::testing_engine::setup::TestingContext;
use matching_engine::fallback::place_initial_offer::{
    PlaceInitialOfferCctpShim as PlaceInitialOfferCctpShimFallback,
    PlaceInitialOfferCctpShimAccounts as PlaceInitialOfferCctpShimFallbackAccounts,
    PlaceInitialOfferCctpShimData as PlaceInitialOfferCctpShimFallbackData,
};
use matching_engine::state::Auction;
use solana_program_test::ProgramTestContext;

use super::fast_market_order_shim::create_fast_market_order_state_from_vaa_data;
use solana_sdk::{pubkey::Pubkey, signer::Signer};

/// Places an initial offer using the fallback program. The vaa is constructed from a passed in PostedVaaData struct. The nonce is forced to 0.
///
/// # Arguments
///
/// * `testing_context` - The testing context of the testing engine
/// * `test_context` - Mutable reference to the test context
/// * `current_state` - The current state of the testing engine
/// * `config` - The config of the place initial offer instruction
/// * `expected_error` - The expected error of the place initial offer instruction
///
/// # Returns
///
/// * `TestingEngineState` - The state of the testing engine after the place initial offer instruction
///
/// # Asserts
///
/// * The expected error is reached
/// * If successful, the solver's USDC balance should decrease by the offer price
pub async fn place_initial_offer_shimful(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &PlaceInitialOfferInstructionConfig,
    expected_error: Option<&ExpectedError>,
) -> TestingEngineState {
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let place_initial_offer_accounts =
        PlaceInitialOfferShimfulAccounts::new(testing_context, current_state, config);

    let offer_actor = config.actor.get_actor(&testing_context.testing_actors);

    let actor_usdc_balance_before = offer_actor
        .get_token_account_balance(test_context, &config.spl_token_enum)
        .await;

    let place_initial_offer_ix = place_initial_offer_shimful_instruction(
        testing_context,
        test_context,
        current_state,
        config,
    )
    .await;

    let transaction = testing_context
        .create_transaction(
            test_context,
            &[place_initial_offer_ix],
            Some(&payer_signer.pubkey()),
            &[&payer_signer],
            None,
            None,
        )
        .await;
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
    evaluate_place_initial_offer_shimful_state(
        testing_context,
        test_context,
        current_state,
        config,
        actor_usdc_balance_before,
        &place_initial_offer_accounts,
    )
    .await
}

/// Evaluate the place initial offer shimful state
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The test context
/// * `current_state` - The current state
/// * `config` - The config
/// * `actor_usdc_balance_before` - The actor USDC balance before
/// * `place_initial_offer_accounts` - The place initial offer shimful accounts
///
/// # Returns
///
/// The testing engine state after the place initial offer shimful instruction
pub async fn evaluate_place_initial_offer_shimful_state(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &PlaceInitialOfferInstructionConfig,
    actor_usdc_balance_before: u64,
    place_initial_offer_accounts: &PlaceInitialOfferShimfulAccounts,
) -> TestingEngineState {
    let expected_error = config.expected_error();
    let offer_actor = config.actor.get_actor(&testing_context.testing_actors);
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    if expected_error.is_none() {
        let actor_usdc_balance_after = offer_actor
            .get_token_account_balance(test_context, &config.spl_token_enum)
            .await;
        assert!(
            actor_usdc_balance_after < actor_usdc_balance_before,
            "Solver USDC balance should have decreased"
        );
        let new_active_auction_state = utils::auction::ActiveAuctionState {
            auction_address: place_initial_offer_accounts.auction,
            auction_custody_token_address: place_initial_offer_accounts.auction_custody_token,
            auction_config_address: place_initial_offer_accounts.auction_config,
            initial_offer: utils::auction::AuctionOffer {
                actor: config.actor,
                participant: payer_signer.pubkey(),
                offer_token: place_initial_offer_accounts.offer_token,
                offer_price: config.offer_price,
            },
            best_offer: utils::auction::AuctionOffer {
                actor: config.actor,
                participant: payer_signer.pubkey(),
                offer_token: place_initial_offer_accounts.offer_token,
                offer_price: config.offer_price,
            },
            spl_token_enum: config.spl_token_enum.clone(),
        };
        let new_auction_state =
            utils::auction::AuctionState::Active(Box::new(new_active_auction_state));
        let initial_offer_placed_state = InitialOfferPlacedState {
            auction_state: new_auction_state,
            auction_accounts: AuctionAccounts::new(
                None,
                offer_actor.clone(),
                current_state.close_account_refund_recipient(),
                place_initial_offer_accounts.auction_config,
                &current_state
                    .router_endpoints()
                    .expect("Router endpoints are not created")
                    .endpoints,
                place_initial_offer_accounts.custodian,
                config.spl_token_enum.clone(),
                current_state.base().transfer_direction,
            ),
        };
        let active_auction_state = initial_offer_placed_state
            .auction_state
            .get_active_auction()
            .unwrap();
        active_auction_state
            .verify_auction(testing_context, test_context)
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
            order_prepared: current_state.order_prepared().cloned(),
        };
    }
    current_state.clone()
}

/// Place the initial offer shimful instruction
///
/// Creates the place initial offer shimful instruction
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The test context
/// * `current_state` - The current state
/// * `config` - The config
///
/// # Returns
///
/// The place initial offer shimful instruction
pub async fn place_initial_offer_shimful_instruction(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &PlaceInitialOfferInstructionConfig,
) -> solana_program::instruction::Instruction {
    let place_initial_offer_accounts =
        PlaceInitialOfferShimfulAccounts::new(testing_context, current_state, config);

    let offer_actor = config.actor.get_actor(&testing_context.testing_actors);

    offer_actor
        .approve_spl_token(
            test_context,
            &place_initial_offer_accounts.transfer_authority,
            420_000__000_000,
            &config.spl_token_enum,
        )
        .await;

    let place_initial_offer_ix_data = PlaceInitialOfferCctpShimFallbackData {
        offer_price: config.offer_price,
    };

    let place_initial_offer_ix_accounts = PlaceInitialOfferCctpShimFallbackAccounts {
        signer: &place_initial_offer_accounts.signer,
        transfer_authority: &place_initial_offer_accounts.transfer_authority,
        custodian: &place_initial_offer_accounts.custodian,
        auction_config: &place_initial_offer_accounts.auction_config,
        from_endpoint: &place_initial_offer_accounts.from_endpoint,
        to_endpoint: &place_initial_offer_accounts.to_endpoint,
        fast_market_order: &place_initial_offer_accounts.fast_market_order,
        auction: &place_initial_offer_accounts.auction,
        offer_token: &place_initial_offer_accounts.offer_token,
        auction_custody_token: &place_initial_offer_accounts.auction_custody_token,
        usdc: &place_initial_offer_accounts.usdc,
        system_program: &place_initial_offer_accounts.system_program,
        token_program: &place_initial_offer_accounts.token_program,
    };
    PlaceInitialOfferCctpShimFallback {
        program_id: &testing_context.get_matching_engine_program_id(),
        accounts: place_initial_offer_ix_accounts,
        data: place_initial_offer_ix_data,
    }
    .instruction()
}

pub struct PlaceInitialOfferShimfulAccounts {
    pub signer: Pubkey,
    pub transfer_authority: Pubkey,
    pub custodian: Pubkey,
    pub auction_config: Pubkey,
    pub from_endpoint: Pubkey,
    pub to_endpoint: Pubkey,
    pub fast_market_order: Pubkey,
    pub auction: Pubkey,
    pub offer_token: Pubkey,
    pub auction_custody_token: Pubkey,
    pub usdc: Pubkey,
    pub system_program: Pubkey,
    pub token_program: Pubkey,
}

impl PlaceInitialOfferShimfulAccounts {
    pub fn new(
        testing_context: &TestingContext,
        current_state: &TestingEngineState,
        config: &PlaceInitialOfferInstructionConfig,
    ) -> Self {
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
        let close_account_refund_recipient =
            config.close_account_refund_recipient.unwrap_or_else(|| {
                current_state
                    .fast_market_order()
                    .unwrap()
                    .close_account_refund_recipient
            });
        let fast_market_order = match &config.fast_market_order_address {
            Some(fast_market_order_address) => *fast_market_order_address,
            None => {
                current_state
                    .fast_market_order()
                    .expect("Fast market order is not created")
                    .fast_market_order_address
            }
        };
        let auction_config = current_state.auction_config_address().unwrap();
        let custodian = current_state.custodian_address().unwrap();
        let program_id = testing_context.get_matching_engine_program_id();
        let fast_transfer_vaa = &current_state
            .base()
            .vaas
            .get(config.test_vaa_pair_index)
            .expect("Failed to get vaa pair")
            .fast_transfer_vaa;
        let vaa_data = fast_transfer_vaa.get_vaa_data();
        let fast_market_order_state =
            create_fast_market_order_state_from_vaa_data(vaa_data, close_account_refund_recipient);
        let offer_actor = config.actor.get_actor(&testing_context.testing_actors);
        let offer_token = match &config.custom_accounts {
            Some(custom_accounts) => match custom_accounts.offer_token_address {
                Some(offer_token_address) => offer_token_address,
                None => offer_actor
                    .token_account_address(&config.spl_token_enum)
                    .unwrap(),
            },
            None => offer_actor
                .token_account_address(&config.spl_token_enum)
                .unwrap(),
        };
        let auction = Pubkey::find_program_address(
            &[Auction::SEED_PREFIX, &fast_market_order_state.digest()],
            &program_id,
        )
        .0;
        let auction_custody_token = Pubkey::find_program_address(
            &[
                matching_engine::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
                auction.as_ref(),
            ],
            &program_id,
        )
        .0;
        let transfer_authority = Pubkey::find_program_address(
            &[
                common::TRANSFER_AUTHORITY_SEED_PREFIX,
                &auction.to_bytes(),
                &config.offer_price.to_be_bytes(),
            ],
            &program_id,
        )
        .0;
        let (from_endpoint, to_endpoint) = config.get_from_and_to_router_endpoints(current_state);
        let usdc = match &config.custom_accounts {
            Some(custom_accounts) => match custom_accounts.mint_address {
                Some(usdc_mint_address) => usdc_mint_address,
                None => testing_context.get_usdc_mint_address(),
            },
            None => testing_context.get_usdc_mint_address(),
        };
        Self {
            signer: payer_signer.pubkey(),
            transfer_authority,
            custodian,
            auction_config,
            from_endpoint,
            to_endpoint,
            fast_market_order,
            auction,
            offer_token,
            auction_custody_token,
            usdc,
            system_program: solana_program::system_program::ID,
            token_program: anchor_spl::token::spl_token::ID,
        }
    }
}
