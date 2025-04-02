//! # Settle auction instruction testing
//!
//! This module contains tests for the settle auction instruction.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//!
//! - `test_settle_auction_complete` - Test that the settle auction instruction works correctly
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

/// Test that the settle auction instruction works correctly
#[tokio::test]
pub async fn test_settle_auction_complete() {
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
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers)
        .await;
}
