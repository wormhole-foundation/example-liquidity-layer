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
use crate::test_scenarios::make_offer::{place_initial_offer_shim, reopen_fast_market_order_shim};
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
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the settle auction instruction works with reopened fast market order
#[tokio::test]
pub async fn test_settle_auction_reopened_fast_market_order() {
    let (initial_state, mut test_context, testing_engine) = Box::pin(place_initial_offer_shim(
        PlaceInitialOfferInstructionConfig::default(),
        Some(VaaArgs::default()),
        TransferDirection::FromEthereumToArbitrum,
    ))
    .await;

    let reopen_fast_market_order_state = Box::pin(reopen_fast_market_order_shim(
        initial_state,
        &mut test_context,
        &testing_engine,
        None,
    ))
    .await;

    let instruction_triggers = vec![
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShim(PrepareOrderInstructionConfig::default()),
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(reopen_fast_market_order_state),
        )
        .await;
}
