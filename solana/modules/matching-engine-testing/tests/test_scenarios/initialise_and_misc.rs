//! # Initialise and misc instruction testing
//!
//! This module contains tests for the initialise and some other miscellaneous setup test scenarios.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//!
//! - `test_initialize_program` - Test that the program is initialised correctly
//! - `test_cctp_token_router_endpoint_creation` - Test that a CCTP token router endpoint is created for the arbitrum and ethereum chains
//! - `test_local_token_router_endpoint_creation` - Test that a local token router endpoint is created for the arbitrum and ethereum chains
//! - `test_setup_vaas` - Test that the vaas are setup correctly
//! - `test_post_message_shims` - Test that the post message shims work correctly
//! - `test_approve_usdc` - Test that the approve usdc helper function works correctly

use crate::shimful;
use crate::shimless;
use crate::testing_engine;
use crate::testing_engine::config::InitializeInstructionConfig;
use crate::utils;
use crate::utils::token_account::SplTokenEnum;
use anchor_lang::AccountDeserialize;
use anchor_spl::token::TokenAccount;
use matching_engine::ID as PROGRAM_ID;
use shimful::post_message::set_up_post_message_transaction_test;
use shimless::initialize::{initialize_program, AuctionParametersConfig};
use solana_program_test::tokio;
use solana_sdk::pubkey::Pubkey;
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::router::add_local_router_endpoint_ix;
use utils::vaa::VaaArgs;
use wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID;

/*
                    Happy path tests section

                    *****************
               ******               ******
           ****                           ****
        ****                                 ***
      ***                                       ***
     **           ***               ***           **
   **           *******           *******          ***
  **            *******           *******            **
 **             *******           *******             **
 **               ***               ***               **
**                                                     **
**       *                                     *       **
**      **                                     **      **
 **   ****                                     ****   **
 **      **                                   **      **
  **       ***                             ***       **
   ***       ****                       ****       ***
     **         ******             ******         **
      ***            ***************            ***
        ****                                 ****
           ****                           ****
               ******               ******
                    *****************
*/

/// Test that the program is initialised correctly
#[tokio::test]
pub async fn test_initialize_program() {
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::None,
        TransferDirection::FromArbitrumToEthereum,
        None, // Vaa args for creating vaas
    )
    .await;

    let initialize_config = InitializeInstructionConfig::default();

    let testing_engine = TestingEngine::new(testing_context).await;

    testing_engine
        .execute(
            &mut test_context,
            vec![InstructionTrigger::InitializeProgram(initialize_config)],
            None,
        )
        .await;
}

/// Test that a CCTP token router endpoint is created for the arbitrum and ethereum chains
#[tokio::test]
pub async fn test_cctp_token_router_endpoint_creation() {
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::None,                            // Shim mode
        TransferDirection::FromArbitrumToEthereum, // Transfer direction
        None,                                      // Vaa args
    )
    .await;

    let initialize_config = InitializeInstructionConfig::default();

    let testing_engine = TestingEngine::new(testing_context).await;

    testing_engine
        .execute(
            &mut test_context,
            vec![InstructionTrigger::InitializeProgram(initialize_config)],
            None,
        )
        .await;
}

/// Test that a local token router endpoint is created for the arbitrum and ethereum chains
#[tokio::test]
pub async fn test_local_token_router_endpoint_creation() {
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::None,
        TransferDirection::FromArbitrumToEthereum,
        None,
    )
    .await;
    let payer_signer = testing_context.testing_actors.payer_signer.clone();
    let initialize_fixture = initialize_program(
        &testing_context,
        &mut test_context,
        AuctionParametersConfig::default(),
        &payer_signer,
        None, // No expected error
        None, // No expected log messages
    )
    .await
    .expect("Failed to initialize program");
    let payer_signer = testing_context.testing_actors.payer_signer.clone();
    let _local_token_router_endpoint = add_local_router_endpoint_ix(
        &testing_context,
        &mut test_context,
        &payer_signer,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.get_custodian_address(),
        testing_context.testing_actors.owner.keypair().as_ref(),
    )
    .await;
}

/// Test setting up vaas
/// Vaa is from arbitrum to ethereum
#[tokio::test]
pub async fn test_setup_vaas() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = vec![VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    }];
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifySignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    testing_context.verify_vaas(&mut test_context).await;

    let testing_engine = TestingEngine::new(testing_context).await;
    testing_engine
        .execute(
            &mut test_context,
            vec![
                InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
                InstructionTrigger::CreateCctpRouterEndpoints(
                    CreateCctpRouterEndpointsInstructionConfig::default(),
                ),
            ],
            None,
        )
        .await;
}

/// Test that the post message shims work correctly
#[tokio::test]
pub async fn test_post_message_shims() {
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        TransferDirection::FromArbitrumToEthereum,
        None,
    )
    .await;
    let actors = &testing_context.testing_actors;
    let emitter_signer = actors.owner.keypair();
    let payer_signer = actors.solvers[0].keypair();
    set_up_post_message_transaction_test(
        &testing_context,
        &mut test_context,
        &payer_signer,
        &emitter_signer,
    )
    .await;
}

/// Test that the approve usdc helper function works correctly
#[tokio::test]
pub async fn test_approve_usdc() {
    let vaa_args = vec![VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    }];
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        TransferDirection::FromArbitrumToEthereum,
        Some(vaa_args),
    )
    .await;
    let first_test_ft = testing_context.get_vaa_pair(0).unwrap().fast_transfer_vaa;
    let vaa_data = first_test_ft.vaa_data;

    let actors = &testing_context.testing_actors;
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
        .approve_spl_token(
            &mut test_context,
            &transfer_authority,
            offer_price,
            &SplTokenEnum::Usdc,
        )
        .await;

    let usdc_balance = solver
        .get_token_account_balance(&mut test_context, &SplTokenEnum::Usdc)
        .await;

    // TODO: Create an issue based on this bug. So this function will transfer the ownership of whatever the guardian signatures signer is set to to the verify shim program. This means that the argument to this function MUST be ephemeral and cannot be used until the close signatures instruction has been executed.
    let _guardian_signature_info = shimful::verify_shim::create_guardian_signatures(
        &testing_context,
        &mut test_context,
        &actors.owner.keypair(),
        &vaa_data,
        &CORE_BRIDGE_PROGRAM_ID,
        None,
    )
    .await
    .expect("Failed to create guardian signatures");

    println!("Solver USDC balance: {:?}", usdc_balance);
    let solver_token_account_address = solver.token_account_address().unwrap();
    let solver_token_account_info = test_context
        .banks_client
        .get_account(solver_token_account_address)
        .await
        .expect("Failed to query banks client for solver token account info")
        .expect("Failed to get solver token account info");
    let solver_token_account =
        TokenAccount::try_deserialize(&mut solver_token_account_info.data.as_ref()).unwrap();
    assert!(solver_token_account.delegate.is_some());
}
