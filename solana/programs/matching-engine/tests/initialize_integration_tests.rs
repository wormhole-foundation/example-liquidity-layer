use anchor_lang::AccountDeserialize;
use anchor_spl::token::TokenAccount;
use matching_engine::state::FastMarketOrder;
use matching_engine::{CCTP_MINT_RECIPIENT, ID as PROGRAM_ID};
use solana_program_test::tokio;
use solana_sdk::pubkey::Pubkey;
mod utils;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::VersionedTransaction;
use utils::auction::{improve_offer, place_initial_offer, AuctionAccounts};
use utils::initialize::initialize_program;
use utils::router::{
    add_local_router_endpoint_ix, create_all_router_endpoints_test,
    create_cctp_router_endpoints_test,
};
use utils::setup::{setup_environment, ShimMode, TestingContext, TransferDirection};
use utils::shims::{
    initialise_fast_market_order_fallback_instruction, place_initial_offer_fallback,
    set_up_post_message_transaction_test,
};
use utils::shims_execute_order::{execute_order_fallback, ExecuteOrderFallbackAccounts};
use utils::vaa::VaaArgs;
use wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID;

/// Test that the program is initialised correctly
#[tokio::test]
pub async fn test_initialize_program() {
    let testing_context = setup_environment(
        ShimMode::None,
        TransferDirection::FromArbitrumToEthereum,
        None,
    )
    .await;

    let initialize_fixture = initialize_program(&testing_context).await;

    // Check that custodian data corresponds to the expected values
    initialize_fixture.verify_custodian(
        testing_context.testing_actors.owner.pubkey(),
        testing_context.testing_actors.owner_assistant.pubkey(),
        testing_context
            .testing_actors
            .fee_recipient
            .token_account
            .unwrap()
            .address,
    );
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

    let initialize_fixture = initialize_program(&testing_context).await;

    let token_router_endpoints = create_cctp_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
    )
    .await;

    assert_eq!(token_router_endpoints.len(), 2);
}

#[tokio::test]
pub async fn test_local_token_router_endpoint_creation() {
    let testing_context = setup_environment(
        ShimMode::None,
        TransferDirection::FromArbitrumToEthereum,
        None,
    )
    .await;

    let initialize_fixture = initialize_program(&testing_context).await;

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
    let mut testing_context =
        setup_environment(ShimMode::PostVaa, transfer_direction, Some(vaa_args)).await;

    testing_context.verify_vaas().await;
    let initialize_fixture = initialize_program(&testing_context).await;

    // Try making initial offer
    let fast_vaa = testing_context
        .get_vaa_pair(0)
        .expect("Failed to get vaa pair")
        .fast_transfer_vaa;
    let fast_vaa_pubkey = fast_vaa.get_vaa_pubkey();
    let auction_config_address = initialize_fixture.get_auction_config_address();
    let router_endpoints = create_all_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
    )
    .await;

    let solver = testing_context.testing_actors.solvers[0].clone();
    let auction_accounts = AuctionAccounts::new(
        Some(fast_vaa_pubkey),                      // Fast VAA pubkey
        solver.clone(),                             // Solver
        auction_config_address.clone(),             // Auction config pubkey
        &router_endpoints,                          // Router endpoints
        initialize_fixture.get_custodian_address(), // Custodian pubkey
        testing_context.get_usdc_mint_address(),    // USDC mint pubkey
        transfer_direction,
    );

    place_initial_offer(&mut testing_context, auction_accounts, fast_vaa, PROGRAM_ID).await;
    let auction_state = testing_context
        .testing_state
        .auction_state
        .get_active_auction()
        .unwrap();
    auction_state
        .verify_initial_offer(&testing_context.test_context)
        .await;

    improve_offer(
        &mut testing_context,
        PROGRAM_ID,
        solver,
        auction_config_address,
    )
    .await;
    // TODO: Implement check on improved offer auction state
    // auction_state
    //     .borrow()
    //     .verify_improved_offer(&testing_context.test_context)
    //     .await;
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
        utils::shims::create_fast_market_order_state_from_vaa_data(&vaa_data, solver.pubkey());
    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
        utils::shims::create_guardian_signatures(
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
        utils::shims::create_fast_market_order_state_from_vaa_data(&vaa_data, solver.pubkey());
    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
        utils::shims::create_guardian_signatures(
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
            &fast_market_order.refund_recipient,
        ],
        &PROGRAM_ID,
    )
    .0;
    utils::shims::close_fast_market_order_fallback(
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
        utils::shims::create_guardian_signatures(
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

    let initialize_fixture = initialize_program(&testing_context).await;

    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;

    // Try making initial offer using the shim instruction
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let auction_config_address = initialize_fixture.get_auction_config_address();
    let router_endpoints = create_all_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
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

    let vaa_data = first_test_ft.vaa_data;

    // Place initial offer using the fallback program
    let payer_signer = testing_context.testing_actors.owner.keypair();
    let _initial_offer_fixture = place_initial_offer_fallback(
        &mut testing_context,
        &payer_signer,
        &PROGRAM_ID,
        &CORE_BRIDGE_PROGRAM_ID,
        &vaa_data,
        solver.clone(),
        &auction_accounts,
        1__000_000, // 1 USDC (double underscore for decimal separator)
    )
    .await
    .expect("Failed to place initial offer");
    // Attempt to improve the offer using the non-fallback method with another solver making the improved offer
    println!("Improving offer");
    let second_solver = testing_context.testing_actors.solvers[1].clone();
    improve_offer(
        &mut testing_context,
        PROGRAM_ID,
        second_solver,
        auction_config_address,
    )
    .await;
    println!("Offer improved");
    // improved_offer_fixture.verify_improved_offer(&testing_context.test_context).await;
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

    let initialize_fixture = initialize_program(&testing_context).await;

    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;

    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Pre-made fixture accounts not found");
    // Try making initial offer using the shim instruction
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let auction_config_address = initialize_fixture.get_auction_config_address();
    let router_endpoints = create_all_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
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

    let vaa_data = first_test_ft.vaa_data;

    let payer_signer = testing_context.testing_actors.owner.keypair();

    // Place initial offer using the fallback program
    let initial_offer_fixture = place_initial_offer_fallback(
        &mut testing_context,
        &payer_signer,
        &PROGRAM_ID,
        &CORE_BRIDGE_PROGRAM_ID,
        &vaa_data,
        solver.clone(),
        &auction_accounts,
        1__000_000, // 1 USDC (double underscore for decimal separator)
    )
    .await
    .expect("Failed to place initial offer");

    println!(
        "Solver balance after placing initial offer: {:?}",
        solver.get_balance(&testing_context.test_context).await
    );

    let execute_order_fallback_accounts = ExecuteOrderFallbackAccounts::new(
        &auction_accounts,
        &initial_offer_fixture,
        &payer_signer.pubkey(),
        &fixture_accounts,
        transfer_direction,
    );
    // Try executing the order using the fallback program
    let _execute_order_fixture = execute_order_fallback(
        &testing_context.test_context,
        &payer_signer,
        &PROGRAM_ID,
        solver.clone(),
        &execute_order_fallback_accounts,
    )
    .await
    .expect("Failed to execute order");

    // Figure out why the solver balance is not increased here
    println!(
        "Solver balance after executing order: {:?}",
        solver.get_balance(&testing_context.test_context).await
    );
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

    let initialize_fixture = initialize_program(&testing_context).await;

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
    let router_endpoints = create_all_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
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
    )
    .await
    .expect("Failed to place initial offer");

    println!(
        "Solver balance after placing initial offer: {:?}",
        solver.get_balance(&testing_context.test_context).await
    );

    let execute_order_fallback_accounts = ExecuteOrderFallbackAccounts::new(
        &auction_accounts,
        &initial_offer_fixture,
        &payer_signer.pubkey(),
        &fixture_accounts,
        transfer_direction,
    );
    // Try executing the order using the fallback program
    let execute_order_fixture = execute_order_fallback(
        &testing_context.test_context,
        &payer_signer,
        &PROGRAM_ID,
        solver.clone(),
        &execute_order_fallback_accounts,
    )
    .await
    .expect("Failed to execute order");

    utils::shims_prepare_order_response::prepare_order_response_test(
        &testing_context.test_context,
        &payer_signer,
        &deposit_vaa_data,
        &CORE_BRIDGE_PROGRAM_ID,
        &PROGRAM_ID,
        &fixture_accounts,
        &execute_order_fixture,
        &initial_offer_fixture,
        &initialize_fixture,
        &router_endpoints.ethereum.endpoint_address,
        &router_endpoints.arbitrum.endpoint_address,
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

    let initialize_fixture = initialize_program(&testing_context).await;

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
    let router_endpoints = create_all_router_endpoints_test(
        &testing_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair(),
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
    )
    .await
    .expect("Failed to place initial offer");

    println!(
        "Solver balance after placing initial offer: {:?}",
        solver.get_balance(&testing_context.test_context).await
    );

    let execute_order_fallback_accounts = ExecuteOrderFallbackAccounts::new(
        &auction_accounts,
        &initial_offer_fixture,
        &payer_signer.pubkey(),
        &fixture_accounts,
        transfer_direction,
    );
    // Try executing the order using the fallback program
    let execute_order_fixture = execute_order_fallback(
        &testing_context.test_context,
        &payer_signer,
        &PROGRAM_ID,
        solver.clone(),
        &execute_order_fallback_accounts,
    )
    .await
    .expect("Failed to execute order");

    let prepare_order_response_shim_fixture =
        utils::shims_prepare_order_response::prepare_order_response_test(
            &testing_context.test_context,
            &payer_signer,
            &deposit_vaa_data,
            &CORE_BRIDGE_PROGRAM_ID,
            &PROGRAM_ID,
            &fixture_accounts,
            &execute_order_fixture,
            &initial_offer_fixture,
            &initialize_fixture,
            &router_endpoints.ethereum.endpoint_address,
            &router_endpoints.arbitrum.endpoint_address,
            &usdc_mint_address,
            &CCTP_MINT_RECIPIENT,
            &initialize_fixture.get_custodian_address(),
            &deposit,
        )
        .await
        .expect("Failed to prepare order response");
    let auction_state = initial_offer_fixture.auction_state;
    utils::settle_auction::settle_auction_complete(
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
