//! # Execute order instruction testing
//!
//! This module contains tests for the execute order instruction.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//! - `test_execute_order_fallback` - Test that the execute order fallback instruction works correctly
//! - `test_execute_order_shimless` - Test that the execute order shimless instruction works correctly
//!

use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig,
};
use crate::utils;

use solana_program_test::tokio;
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::vaa::VaaArgs;

/// Test that the execute order fallback instruction works correctly
#[tokio::test]
// TODO: Flesh out this test to see if the message was posted correctly
pub async fn test_execute_order_fallback() {
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
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/// Test that the execute order shimless instruction works correctly
#[tokio::test]
pub async fn test_execute_order_shimless() {
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
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShimless(ExecuteOrderInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/*
    Sad path tests
*/

/// Test that the execute order fallback instruction blocks the shimless instruction
#[tokio::test]
pub async fn test_execute_order_fallback_blocks_shimless() {
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
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShimless(ExecuteOrderInstructionConfig {
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 3012,
                error_string: "AccountNotInitialized".to_string(),
            }),
            ..ExecuteOrderInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}
