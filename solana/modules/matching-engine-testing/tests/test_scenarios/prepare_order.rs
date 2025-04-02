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
//! - `test_prepare_order_shim_fallback` - Test that the prepare order shim fallback instruction works correctly
//! - `test_prepare_order_shimless` - Test that the prepare order shimless instruction works correctly
//!

use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig, PrepareOrderInstructionConfig,
};
use crate::utils;

use solana_program_test::tokio;
use solana_sdk::transaction::TransactionError;
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::vaa::VaaArgs;

/// Test that the prepare order fallback instruction works correctly (from ethereum to arbitrum)
#[tokio::test]
pub async fn test_prepare_order_shim_fallback() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
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
        InstructionTrigger::PrepareOrderShim(PrepareOrderInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/// Test that the prepare order shimless instruction works correctly (from ethereum to arbitrum)
#[tokio::test]
pub async fn test_prepare_order_shimless() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
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
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShimless(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShimless(PrepareOrderInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/*
    Sad path tests
*/

/// Test that the prepare order response shimless instruction blocks the shimful instruction
#[tokio::test]
pub async fn test_prepare_order_response_shimless_blocks_shimful() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
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
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShimless(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShimless(PrepareOrderInstructionConfig::default()),
        // TODO: Figure out why this is failing on account already in use rather than the what happens the other way around above
        InstructionTrigger::PrepareOrderShim(PrepareOrderInstructionConfig {
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: TransactionError::AccountInUse.to_string(),
            }),
            ..PrepareOrderInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}

/// Test that the prepare order response shimful instruction blocks the shimless instruction
#[tokio::test]
pub async fn test_prepare_order_response_shimful_blocks_shimless() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
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
        InstructionTrigger::PrepareOrderShim(PrepareOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShimless(PrepareOrderInstructionConfig {
            expected_log_messages: Some(vec![ExpectedLog {
                log_message: "Already prepared".to_string(),
                count: 1,
            }]),
            ..PrepareOrderInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}
