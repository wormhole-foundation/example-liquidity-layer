#![allow(clippy::expect_used)]
#![allow(clippy::panic)]

//! # Make offer instruction testing
//!
//! This module contains tests for the place initial offer and improve offer instructions.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//!
//! - `test_place_initial_offer_fallback` - Test that the place initial offer fallback instruction works correctly
//!
//! ### Sad path tests
//!
//! - `test_place_initial_offer_fails_if_fast_market_order_not_created` - Test that the place initial offer fails if the fast market order is not created
//!
use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig,
};
use crate::testing_engine::state::TestingEngineState;
use crate::utils;
use crate::utils::auction::compare_auctions;

use anchor_lang::error::ErrorCode;
use anchor_lang::AccountDeserialize;
use matching_engine::state::Auction;
use solana_program_test::{tokio, ProgramTestContext};
use solana_sdk::transaction::TransactionError;
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::vaa::VaaArgs;

/*
    Happy path tests
*/

/// Test that the place initial offer fallback instruction works correctly from arbitrum to ethereum
#[tokio::test]
pub async fn test_place_initial_offer_fallback() {
    let config = PlaceInitialOfferInstructionConfig::default();
    let (final_state, _) = place_initial_offer_fallback(config).await;
    assert_eq!(
        final_state
            .fast_market_order()
            .unwrap()
            .fast_market_order
            .digest(),
        final_state
            .base()
            .vaas
            .first()
            .unwrap()
            .fast_transfer_vaa
            .get_vaa_data()
            .digest()
    );
}

/// Test that the place initial offer instruction works correctly without the shim instructions
#[tokio::test]
pub async fn test_place_initial_offer_shimless() {
    let config = PlaceInitialOfferInstructionConfig::default();
    let (_final_state, _) = place_initial_offer_shimless(config).await;
}

/// Test that auction account is exactly the same when using shimless and fallback instructions
#[tokio::test]
pub async fn test_place_initial_offer_shimless_and_fallback_are_identical() {
    let config = PlaceInitialOfferInstructionConfig {
        actor: TestingActorEnum::Owner,
        ..PlaceInitialOfferInstructionConfig::default()
    };
    let (final_state_shimless, mut shimless_test_context) =
        place_initial_offer_shimless(config.clone()).await;
    let (final_state_fallback, mut fallback_test_context) =
        place_initial_offer_fallback(config.clone()).await;

    let shimless_auction = {
        let shimless_active_auction_address = final_state_shimless
            .auction_state()
            .get_active_auction()
            .unwrap()
            .auction_address;
        let shimless_auction_account_data = shimless_test_context
            .banks_client
            .get_account(shimless_active_auction_address)
            .await
            .unwrap()
            .unwrap()
            .data;
        Auction::try_deserialize(&mut &shimless_auction_account_data[..]).unwrap()
    };
    let shimful_auction = {
        let shimful_active_auction_address = final_state_fallback
            .auction_state()
            .get_active_auction()
            .unwrap()
            .auction_address;
        let shimful_account_data = fallback_test_context
            .banks_client
            .get_account(shimful_active_auction_address)
            .await
            .unwrap()
            .unwrap()
            .data;
        Auction::try_deserialize(&mut &shimful_account_data[..]).unwrap()
    };
    compare_auctions(&shimless_auction, &shimful_auction).await;
}

pub async fn place_initial_offer_fallback(
    config: PlaceInitialOfferInstructionConfig,
) -> (TestingEngineState, ProgramTestContext) {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    };
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;

    let testing_engine = TestingEngine::new(testing_context).await;

    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(config),
    ];

    (
        testing_engine
            .execute(&mut test_context, instruction_triggers)
            .await,
        test_context,
    )
}

pub async fn place_initial_offer_shimless(
    config: PlaceInitialOfferInstructionConfig,
) -> (TestingEngineState, ProgramTestContext) {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let testing_engine = TestingEngine::new(testing_context).await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShimless(config),
    ];
    (
        testing_engine
            .execute(&mut test_context, instruction_triggers)
            .await,
        test_context,
    )
}

/*
    Sad path tests
*/

/// Test that the shimless place initial offer instruction blocks the shim instruction
#[tokio::test]
pub async fn test_place_initial_offer_non_shim_blocks_shim() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let testing_engine = TestingEngine::new(testing_context).await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(0),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(1),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: TransactionError::AccountInUse.to_string(),
            }),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/// Test that the place initial offer shim blocks the non shim instruction
#[tokio::test]
pub async fn test_place_initial_offer_shim_blocks_non_shim() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let testing_engine = TestingEngine::new(testing_context).await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(0),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(1),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: TransactionError::AccountInUse.to_string(),
            }),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
    ];

    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/// Test that the place initial offer fails if the fast market order is not created
#[tokio::test]
pub async fn test_place_initial_offer_fails_if_fast_market_order_not_created() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let vaa_args = VaaArgs {
        post_vaa: true,
        ..VaaArgs::default()
    };

    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let fake_fast_market_order_address = testing_context
        .get_vaa_pair(0)
        .unwrap()
        .fast_transfer_vaa
        .vaa_pubkey;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig {
            fast_market_order_address: OverwriteCurrentState::Some(fake_fast_market_order_address),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(ErrorCode::ConstraintOwner),
                error_string: "Fast market order account owner is invalid".to_string(),
            }),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
    ];

    let testing_engine = TestingEngine::new(testing_context).await;
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}
