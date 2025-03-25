use anchor_lang::AccountDeserialize;
use anchor_spl::token::TokenAccount;
use matching_engine::error::MatchingEngineError;
use matching_engine::state::FastMarketOrder;
use matching_engine::{CCTP_MINT_RECIPIENT, ID as PROGRAM_ID};
use shimless::execute_order::execute_order_shimless_test;
use solana_program_test::tokio;
use solana_sdk::pubkey::Pubkey;
use testing_engine::config::CreateCctpRouterEndpointsInstructionConfig;
use utils::constants;
mod shimful;
mod shimless;
mod testing_engine;
mod utils;
use crate::testing_engine::config::{
    ExpectedError, ImproveOfferInstructionConfig, InitializeInstructionConfig,
    PlaceInitialOfferInstructionConfig,
};
use crate::testing_engine::engine::{InstructionTrigger, TestingEngine};
use shimful::shims::{
    initialise_fast_market_order_fallback_instruction, place_initial_offer_fallback,
    place_initial_offer_fallback_test, set_up_post_message_transaction_test,
};
use shimful::shims_execute_order::execute_order_fallback_test;
use shimless::initialize::{initialize_program, AuctionParametersConfig};
use shimless::make_offer::{improve_offer, place_initial_offer_shimless};
use solana_sdk::transaction::{TransactionError, VersionedTransaction};
use utils::auction::AuctionAccounts;
use utils::router::{add_local_router_endpoint_ix, create_all_router_endpoints_test};
use utils::setup::{setup_environment, ShimMode, TestingContext, TransferDirection};
use utils::vaa::VaaArgs;
use wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID;

/// Test that the program is initialised correctly
#[tokio::test]
pub async fn test_initialize_program() {
    let testing_context = setup_environment(
        ShimMode::None,
        TransferDirection::FromArbitrumToEthereum,
        None, // Vaa args for creating vaas
    )
    .await;

    let initialize_config = InitializeInstructionConfig::default();

    let testing_engine = TestingEngine::new(testing_context).await;

    testing_engine
        .execute(vec![InstructionTrigger::InitializeProgram(
            initialize_config,
        )])
        .await;
}

/// Test that a CCTP token router endpoint is created for the arbitrum and ethereum chains
#[tokio::test]
pub async fn test_cctp_token_router_endpoint_creation() {
    let testing_context = setup_environment(
        ShimMode::None,                            // Shim mode
        TransferDirection::FromArbitrumToEthereum, // Transfer direction
        None,                                      // Vaa args
    )
    .await;

    let initialize_config = InitializeInstructionConfig::default();

    let testing_engine = TestingEngine::new(testing_context).await;

    testing_engine
        .execute(vec![InstructionTrigger::InitializeProgram(
            initialize_config,
        )])
        .await;
}

#[tokio::test]
pub async fn test_local_token_router_endpoint_creation() {
    let testing_context = setup_environment(
        ShimMode::None,
        TransferDirection::FromArbitrumToEthereum,
        None,
    )
    .await;

    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");

    let _local_token_router_endpoint = add_local_router_endpoint_ix(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair().as_ref(),
    )
    .await;
}

// Test setting up vaas
// Vaa is from arbitrum to ethereum
// - The payload of the vaa should be the .to_vec() of the FastMarketOrder under universal/rs/messages/src/fast_market_order.rs
#[tokio::test]
pub async fn test_setup_vaas() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let testing_context =
        setup_environment(ShimMode::PostVaa, transfer_direction, Some(vaa_args)).await;

    testing_context.verify_vaas().await;

    let testing_engine = TestingEngine::new(testing_context).await;
    testing_engine
        .execute(vec![
            InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
            InstructionTrigger::CreateCctpRouterEndpoints(
                CreateCctpRouterEndpointsInstructionConfig::default(),
            ),
            InstructionTrigger::PlaceInitialOfferShimless(
                PlaceInitialOfferInstructionConfig::default(),
            ),
            InstructionTrigger::ImproveOfferShimless(ImproveOfferInstructionConfig::default()),
        ])
        .await;
}

#[tokio::test]
pub async fn test_post_message_shims() {
    let testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        TransferDirection::FromArbitrumToEthereum,
        None,
    )
    .await;
    let actors = testing_context.testing_actors;
    let emitter_signer = actors.owner.keypair();
    let payer_signer = actors.solvers[0].keypair();
    set_up_post_message_transaction_test(
        &testing_context.test_context,
        &payer_signer,
        &emitter_signer,
    )
    .await;
}

#[tokio::test]
pub async fn test_initialise_fast_market_order_fallback() {
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        TransferDirection::FromArbitrumToEthereum,
        Some(vaa_args),
    )
    .await;

    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let solver = testing_context.testing_actors.solvers[0].clone();

    let vaa_data = first_test_ft.vaa_data;
    let (fast_market_order, vaa_data) =
        shimful::shims::create_fast_market_order_state_from_vaa_data(&vaa_data, solver.pubkey());
    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
        shimful::shims::create_guardian_signatures(
            &testing_context.test_context,
            &testing_context.testing_actors.owner.keypair(),
            &vaa_data,
            &CORE_BRIDGE_PROGRAM_ID,
            None,
        )
        .await;

    let initialise_fast_market_order_ix = initialise_fast_market_order_fallback_instruction(
        &testing_context.testing_actors.owner.keypair(),
        &PROGRAM_ID,
        fast_market_order,
        guardian_set_pubkey,
        guardian_signatures_pubkey,
        guardian_set_bump,
    );
    let recent_blockhash = testing_context.test_context.borrow().last_blockhash;
    let transaction = solana_sdk::transaction::Transaction::new_signed_with_payer(
        &[initialise_fast_market_order_ix],
        Some(&testing_context.testing_actors.owner.pubkey()),
        &[&testing_context.testing_actors.owner.keypair()],
        recent_blockhash,
    );
    let versioned_transaction = VersionedTransaction::try_from(transaction)
        .expect("Failed to convert transaction to versioned transaction");
    testing_context
        .test_context
        .borrow_mut()
        .banks_client
        .process_transaction(versioned_transaction)
        .await
        .expect("Failed to initialise fast market order");
}

#[tokio::test]
pub async fn test_close_fast_market_order_fallback() {
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        TransferDirection::FromArbitrumToEthereum,
        Some(vaa_args),
    )
    .await;
    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let solver = testing_context.testing_actors.solvers[0].clone();

    let vaa_data = first_test_ft.vaa_data;
    let (fast_market_order, vaa_data) =
        shimful::shims::create_fast_market_order_state_from_vaa_data(&vaa_data, solver.pubkey());
    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
        shimful::shims::create_guardian_signatures(
            &testing_context.test_context,
            &testing_context.testing_actors.owner.keypair(),
            &vaa_data,
            &CORE_BRIDGE_PROGRAM_ID,
            None,
        )
        .await;

    let initialise_fast_market_order_ix = initialise_fast_market_order_fallback_instruction(
        &testing_context.testing_actors.owner.keypair(),
        &PROGRAM_ID,
        fast_market_order,
        guardian_set_pubkey,
        guardian_signatures_pubkey,
        guardian_set_bump,
    );
    let recent_blockhash = testing_context.test_context.borrow().last_blockhash;
    // Get balance of solver before initialising fast market order
    let solver_balance_before = testing_context
        .test_context
        .borrow_mut()
        .banks_client
        .get_balance(solver.pubkey())
        .await
        .expect("Failed to get balance of solver");
    let transaction = solana_sdk::transaction::Transaction::new_signed_with_payer(
        &[initialise_fast_market_order_ix],
        Some(&testing_context.testing_actors.owner.pubkey()),
        &[&testing_context.testing_actors.owner.keypair()],
        recent_blockhash,
    );
    let versioned_transaction = VersionedTransaction::try_from(transaction)
        .expect("Failed to convert transaction to versioned transaction");
    testing_context
        .test_context
        .borrow_mut()
        .banks_client
        .process_transaction(versioned_transaction)
        .await
        .expect("Failed to initialise fast market order");
    let fast_market_order_account = Pubkey::find_program_address(
        &[
            FastMarketOrder::SEED_PREFIX,
            &fast_market_order.digest(),
            &fast_market_order.close_account_refund_recipient,
        ],
        &PROGRAM_ID,
    )
    .0;
    shimful::shims::close_fast_market_order_fallback(
        &testing_context.test_context,
        &solver.keypair(),
        &PROGRAM_ID,
        &fast_market_order_account,
    )
    .await;
    let solver_balance_after = testing_context
        .test_context
        .borrow_mut()
        .banks_client
        .get_balance(solver.pubkey())
        .await
        .expect("Failed to get balance of solver");
    assert!(solver_balance_after > solver_balance_before, "Solver balance before initialising fast market order was {:?}, but after closing it was {:?}, though it should have been greater", solver_balance_before, solver_balance_after);
}

#[tokio::test]
pub async fn test_approve_usdc() {
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        TransferDirection::FromArbitrumToEthereum,
        Some(vaa_args),
    )
    .await;
    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let vaa_data = first_test_ft.vaa_data;

    let actors = testing_context.testing_actors;
    let solver = actors.solvers[0].clone();
    let offer_price: u64 = 1__000_000;
    let program_id = PROGRAM_ID;
    let new_pubkey = Pubkey::new_unique();

    let transfer_authority = Pubkey::find_program_address(
        &[
            common::TRANSFER_AUTHORITY_SEED_PREFIX,
            &new_pubkey.to_bytes(),
            &offer_price.to_be_bytes(),
        ],
        &program_id,
    )
    .0;
    solver
        .approve_usdc(
            &testing_context.test_context,
            &transfer_authority,
            offer_price,
        )
        .await;

    let usdc_balance = solver.get_balance(&testing_context.test_context).await;

    // TODO: Create an issue based on this bug. So this function will transfer the ownership of whatever the guardian signatures signer is set to to the verify shim program. This means that the argument to this function MUST be ephemeral and cannot be used until the close signatures instruction has been executed.
    let (_guardian_set_pubkey, _guardian_signatures_pubkey, _guardian_set_bump) =
        shimful::shims::create_guardian_signatures(
            &testing_context.test_context,
            &actors.owner.keypair(),
            &vaa_data,
            &CORE_BRIDGE_PROGRAM_ID,
            None,
        )
        .await;

    println!("Solver USDC balance: {:?}", usdc_balance);
    let solver_token_account_address = solver.token_account_address().unwrap();
    let solver_token_account_info = testing_context
        .test_context
        .borrow_mut()
        .banks_client
        .get_account(solver_token_account_address)
        .await
        .expect("Failed to query banks client for solver token account info")
        .expect("Failed to get solver token account info");
    let solver_token_account =
        TokenAccount::try_deserialize(&mut solver_token_account_info.data.as_ref()).unwrap();
    assert!(solver_token_account.delegate.is_some());
}

#[tokio::test]
// Testing a initial offer from arbitrum to ethereum
// TODO: Make a test that checks that the auction account and maybe some other accounts are exactly the same as when using the fallback instruction
pub async fn test_place_initial_offer_fallback() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");
    let auction_accounts = utils::auction::AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        None,
    )
    .await;
    let initial_offer_fixture = place_initial_offer_fallback_test(
        &mut testing_context,
        &auction_accounts,
        true, // Expected to pass
    )
    .await;
    let auction_config_address = initialize_fixture.get_auction_config_address();

    // Attempt to improve the offer using the non-fallback method with another solver making the improved offer
    println!("Improving offer");
    let auction_state = initial_offer_fixture
        .expect("Failed to get initial offer fixture")
        .auction_state;
    let second_solver = testing_context.testing_actors.solvers[1].clone();
    improve_offer(
        &mut testing_context,
        PROGRAM_ID,
        second_solver,
        auction_config_address,
        500_000,
        &auction_state,
        None,
    )
    .await;
    println!("Offer improved");
    // improved_offer_fixture.verify_improved_offer(&testing_context.test_context).await;
}

#[tokio::test]
pub async fn test_place_initial_offer_shim_blocks_non_shim() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");
    let auction_accounts = utils::auction::AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        None,
    )
    .await;
    let initial_offer_fallback_fixture = place_initial_offer_fallback_test(
        &mut testing_context,
        &auction_accounts, // Auction accounts have not been created yet
        true,              // Expected to pass
    )
    .await
    .expect("Should have been able to place initial offer");
    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    // Now test without the fallback program
    let mut auction_accounts = initial_offer_fallback_fixture.auction_accounts;
    auction_accounts.fast_vaa = Some(first_test_ft.get_vaa_pubkey());

    let offer_price = 1__000_000;
    let transaction_error = TransactionError::AccountInUse;
    place_initial_offer_shimless(
        &mut testing_context,
        &auction_accounts,
        &first_test_ft,
        offer_price,
        PROGRAM_ID,
        Some(&ExpectedError {
            instruction_index: 0,
            error_code: 0, // This is the error code for account in use
            error_string: transaction_error.to_string(),
        }), // Expected to fail
    )
    .await;
}

#[tokio::test]
pub async fn test_place_initial_offer_non_shim_blocks_shim() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");
    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let auction_accounts = utils::auction::AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        Some(first_test_ft.get_vaa_pubkey()),
    )
    .await;
    // Place initial offer using the shimless instruction
    let offer_price = 1__000_000;
    place_initial_offer_shimless(
        &mut testing_context,
        &auction_accounts,
        &first_test_ft,
        offer_price,
        PROGRAM_ID,
        None, // Expected to pass
    )
    .await;
    // Now test with the fallback program (shims) and expect it to fail
    let none_initial_offer_fallback_fixture = place_initial_offer_fallback_test(
        &mut testing_context,
        &auction_accounts,
        false, // Expected to fail
    )
    .await;
    assert!(none_initial_offer_fallback_fixture.is_none());
}

#[tokio::test]
// Testing an execute order from arbitrum to ethereum
// TODO: Flesh out this test to see if the message was posted correctly
pub async fn test_execute_order_fallback() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");
    let auction_accounts = utils::auction::AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        None,
    )
    .await;
    let initial_offer_fallback_fixture = place_initial_offer_fallback_test(
        &mut testing_context,
        &auction_accounts,
        true, // Expected to pass
    )
    .await
    .expect("Should have been able to place initial offer");

    let solver = testing_context.testing_actors.solvers[0].clone();
    let balance_before_execute_order = solver.get_balance(&testing_context.test_context).await;
    println!(
        "Solver balance after placing initial offer: {:?}",
        balance_before_execute_order
    );

    let _execute_order_fixture = execute_order_fallback_test(
        &mut testing_context,
        &auction_accounts,
        &initial_offer_fallback_fixture,
        solver.clone(),
        true, // Expected to pass
    )
    .await
    .expect("Failed to execute order");

    let balance_after_execute_order = solver.get_balance(&testing_context.test_context).await;
    assert!(
        balance_after_execute_order > balance_before_execute_order,
        "Solver balance after executing order was {:?}, but should have been greater",
        balance_after_execute_order
    );
}

#[tokio::test]
pub async fn test_execute_order_shimless() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");

    let first_test_fast_transfer = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let first_test_fast_transfer_pubkey = first_test_fast_transfer.get_vaa_pubkey();
    let auction_accounts = utils::auction::AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        Some(first_test_fast_transfer_pubkey),
    )
    .await;
    let offer_price = 1__000_000;
    let auction_state = place_initial_offer_shimless(
        &mut testing_context,
        &auction_accounts,
        &first_test_fast_transfer,
        offer_price,
        PROGRAM_ID,
        None, // Expected to pass
    )
    .await;
    let execute_order_fixture = execute_order_shimless_test(
        &mut testing_context,
        &auction_accounts,
        &auction_state,
        None,
    )
    .await;
    assert!(execute_order_fixture.is_some());
}
pub async fn test_execute_order_fallback_blocks_shimless() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let first_test_fast_transfer = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");
    let auction_accounts = utils::auction::AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        Some(first_test_fast_transfer.get_vaa_pubkey()),
    )
    .await;
    let initial_offer_fallback_fixture = place_initial_offer_fallback_test(
        &mut testing_context,
        &auction_accounts,
        true, // Expected to pass
    )
    .await
    .expect("Should have been able to place initial offer");

    let solver = testing_context.testing_actors.solvers[0].clone();

    // Try executing the order using the fallback program
    let _shim_execute_order_fixture = execute_order_fallback_test(
        &mut testing_context,
        &auction_accounts,
        &initial_offer_fallback_fixture,
        solver.clone(),
        true, // Expected to pass
    )
    .await
    .expect("Failed to execute order");
    let auction_state = initial_offer_fallback_fixture.auction_state;
    let expected_error = Some(ExpectedError {
        instruction_index: 0,
        error_code: MatchingEngineError::AccountAlreadyInitialized.into(),
        error_string: MatchingEngineError::AccountAlreadyInitialized.to_string(),
    });
    let shimless_execute_order_fixture = execute_order_shimless_test(
        &mut testing_context,
        &auction_accounts,
        &auction_state,
        expected_error,
    )
    .await;
    assert!(shimless_execute_order_fixture.is_none());
}

// From ethereum to arbitrum
#[tokio::test]
pub async fn test_prepare_order_shim_fallback() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");

    let first_vaa_pair = testing_context.get_vaa_pair(0).unwrap();
    let payload_deserialized: utils::vaa::PayloadDeserialized = first_vaa_pair
        .deposit_vaa
        .clone()
        .payload_deserialized
        .unwrap();
    let deposit = payload_deserialized.get_deposit().unwrap();

    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Pre-made fixture accounts not found");

    // Try making initial offer using the shim instruction
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let auction_accounts = AuctionAccounts::create_auction_accounts(
        &mut testing_context,
        &initialize_fixture,
        transfer_direction,
        None,
    )
    .await;

    // Place initial offer using the fallback program
    let initial_offer_fixture = place_initial_offer_fallback_test(
        &mut testing_context,
        &auction_accounts,
        true, // Expected to pass
    )
    .await
    .expect("Failed to place initial offer");

    let solver = testing_context.testing_actors.solvers[0].clone();

    let deposit_vaa_data = first_vaa_pair.deposit_vaa.vaa_data;

    let payer_signer = testing_context.testing_actors.owner.keypair();

    let execute_order_fixture = execute_order_fallback_test(
        &mut testing_context,
        &auction_accounts,
        &initial_offer_fixture,
        solver.clone(),
        true, // Expected to pass
    )
    .await
    .expect("Failed to execute order");
    shimful::shims_prepare_order_response::prepare_order_response_test(
        &testing_context.test_context,
        &payer_signer,
        &deposit_vaa_data,
        &CORE_BRIDGE_PROGRAM_ID,
        &PROGRAM_ID,
        &fixture_accounts,
        &execute_order_fixture,
        &initial_offer_fixture,
        &initialize_fixture,
        &auction_accounts.to_router_endpoint,
        &auction_accounts.from_router_endpoint,
        &usdc_mint_address,
        &CCTP_MINT_RECIPIENT,
        &initialize_fixture.get_custodian_address(),
        &deposit,
    )
    .await
    .expect("Failed to prepare order response");
}

#[tokio::test]
pub async fn test_settle_auction_complete() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let mut testing_context = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    let initialize_fixture =
        initialize_program(&testing_context, AuctionParametersConfig::default(), None)
            .await
            .expect("Failed to initialize program");

    let first_vaa_pair = testing_context.get_vaa_pair(0).unwrap();

    let payload_deserialized: utils::vaa::PayloadDeserialized = first_vaa_pair
        .deposit_vaa
        .clone()
        .payload_deserialized
        .unwrap();
    let deposit = payload_deserialized.get_deposit().unwrap();

    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Pre-made fixture accounts not found");
    // Try making initial offer using the shim instruction
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let auction_config_address = initialize_fixture.get_auction_config_address();
    let router_config = CreateCctpRouterEndpointsInstructionConfig::default();
    let router_endpoints = create_all_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
        router_config.chains,
    )
    .await;

    let solver = testing_context.testing_actors.solvers[0].clone();
    let auction_accounts = AuctionAccounts::new(
        None,                                       // Fast VAA pubkey
        solver.clone(),                             // Solver
        auction_config_address.clone(),             // Auction config pubkey
        &router_endpoints,                          // Router endpoints
        initialize_fixture.get_custodian_address(), // Custodian pubkey
        usdc_mint_address,                          // USDC mint pubkey
        transfer_direction,
    );

    let fast_transfer_vaa_data = first_vaa_pair.fast_transfer_vaa.vaa_data;
    let deposit_vaa_data = first_vaa_pair.deposit_vaa.vaa_data;

    let payer_signer = testing_context.testing_actors.owner.keypair();

    // Place initial offer using the fallback program
    let initial_offer_fixture = place_initial_offer_fallback(
        &mut testing_context,
        &payer_signer,
        &PROGRAM_ID,
        &CORE_BRIDGE_PROGRAM_ID,
        &fast_transfer_vaa_data,
        solver.clone(),
        &auction_accounts,
        1__000_000, // 1 USDC (double underscore for decimal separator)
        true,
    )
    .await
    .expect("Failed to place initial offer");

    println!(
        "Solver balance after placing initial offer: {:?}",
        solver.get_balance(&testing_context.test_context).await
    );

    let execute_order_fixture = execute_order_fallback_test(
        &mut testing_context,
        &auction_accounts,
        &initial_offer_fixture,
        solver.clone(),
        true, // Expected to pass
    )
    .await
    .expect("Failed to execute order");
    let prepare_order_response_shim_fixture =
        shimful::shims_prepare_order_response::prepare_order_response_test(
            &testing_context.test_context,
            &payer_signer,
            &deposit_vaa_data,
            &CORE_BRIDGE_PROGRAM_ID,
            &PROGRAM_ID,
            &fixture_accounts,
            &execute_order_fixture,
            &initial_offer_fixture,
            &initialize_fixture,
            &auction_accounts.to_router_endpoint,
            &auction_accounts.from_router_endpoint,
            &usdc_mint_address,
            &CCTP_MINT_RECIPIENT,
            &initialize_fixture.get_custodian_address(),
            &deposit,
        )
        .await
        .expect("Failed to prepare order response");
    let auction_state = initial_offer_fixture.auction_state;
    shimless::settle_auction::settle_auction_complete(
        &testing_context.test_context,
        &payer_signer,
        &usdc_mint_address,
        &prepare_order_response_shim_fixture,
        &auction_state,
        &PROGRAM_ID,
    )
    .await
    .expect("Failed to settle auction");
}
