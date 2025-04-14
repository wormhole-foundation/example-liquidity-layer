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

/// Test that the settle auction instruction results in the same balance changes for shim as non shim
#[tokio::test]
pub async fn test_settle_auction_balance_changes() {
    // Run both tests and compare results
    let balance_changes_shim = Box::pin(helpers::balance_changes_shim()).await;
    let balance_changes_shimless = Box::pin(helpers::balance_changes_shimless()).await;

    // Compare results
    helpers::compare_balance_changes(&balance_changes_shim, &balance_changes_shimless);
}

mod helpers {
    use super::*;

    pub async fn balance_changes_shim() -> BalanceChanges {
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
        let initial_state_balances_shim = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        let instruction_triggers = vec![
            InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
            InstructionTrigger::CreateCctpRouterEndpoints(
                CreateCctpRouterEndpointsInstructionConfig::default(),
            ),
            InstructionTrigger::InitializeFastMarketOrderShim(
                InitializeFastMarketOrderShimInstructionConfig {
                    close_account_refund_recipient: Some(
                        testing_engine.testing_context.testing_actors.owner.pubkey(),
                    ),
                    ..InitializeFastMarketOrderShimInstructionConfig::default()
                },
            ),
            InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        ];
        let place_initial_offer_state = testing_engine
            .execute(&mut test_context, instruction_triggers, None)
            .await;
        let place_initial_offer_balances_shim = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        println!(
            "place_initial_offer_balances_shim: {:?}",
            place_initial_offer_balances_shim
                .get(&TestingActorEnum::Solver(0))
                .unwrap()
                .lamports
        );
        let instruction_triggers = vec![
            InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
            InstructionTrigger::PrepareOrderShim(PrepareOrderInstructionConfig::default()),
        ];
        let prepare_order_state = testing_engine
            .execute(
                &mut test_context,
                instruction_triggers,
                Some(place_initial_offer_state),
            )
            .await;
        let prepare_order_balances_shim = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        println!(
            "prepare_order_balances_shim: {:?}",
            prepare_order_balances_shim
                .get(&TestingActorEnum::Solver(0))
                .unwrap()
                .lamports
        );
        let instruction_triggers = vec![InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig {
                close_account_refund_recipient_keypair: Some(
                    testing_engine
                        .testing_context
                        .testing_actors
                        .owner
                        .keypair(),
                ),
                ..CloseFastMarketOrderShimInstructionConfig::default()
            },
        )];
        let close_fast_market_order_state = testing_engine
            .execute(
                &mut test_context,
                instruction_triggers,
                Some(prepare_order_state),
            )
            .await;
        let close_fast_market_order_balances_shim = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        println!(
            "close_fast_market_order_balances_shim: {:?}",
            close_fast_market_order_balances_shim
                .get(&TestingActorEnum::Solver(0))
                .unwrap()
                .lamports
        );
        let instruction_triggers = vec![InstructionTrigger::SettleAuction(
            SettleAuctionInstructionConfig::default(),
        )];
        testing_engine
            .execute(
                &mut test_context,
                instruction_triggers,
                Some(close_fast_market_order_state),
            )
            .await;
        let final_state_balances_shim = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;

        BalanceChanges::from((&initial_state_balances_shim, &final_state_balances_shim))
    }

    pub async fn balance_changes_shimless() -> BalanceChanges {
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
        let initial_state_balances_shimless = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        let instruction_triggers = vec![
            InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
            InstructionTrigger::CreateCctpRouterEndpoints(
                CreateCctpRouterEndpointsInstructionConfig::default(),
            ),
            InstructionTrigger::PlaceInitialOfferShimless(
                PlaceInitialOfferInstructionConfig::default(),
            ),
        ];
        let place_initial_offer_state = testing_engine
            .execute(&mut test_context, instruction_triggers, None)
            .await;
        let place_initial_offer_balances_shimless = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        println!(
            "place_initial_offer_balances_shimless: {:?}",
            place_initial_offer_balances_shimless
                .get(&TestingActorEnum::Owner)
                .unwrap()
                .lamports
        );
        let instruction_triggers = vec![
            InstructionTrigger::ExecuteOrderShimless(ExecuteOrderInstructionConfig::default()),
            InstructionTrigger::PrepareOrderShimless(PrepareOrderInstructionConfig::default()),
            InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
        ];
        testing_engine
            .execute(
                &mut test_context,
                instruction_triggers,
                Some(place_initial_offer_state),
            )
            .await;
        let final_state_balances_shimless = testing_engine
            .testing_context
            .get_balances(&mut test_context)
            .await;
        BalanceChanges::from((
            &initial_state_balances_shimless,
            &final_state_balances_shimless,
        ))
    }

    pub fn compare_balance_changes(shim: &BalanceChanges, shimless: &BalanceChanges) {
        let shimless_owner_balance_change =
            shimless.get(&TestingActorEnum::Owner).unwrap().lamports;
        let shim_owner_balance_change = shim.get(&TestingActorEnum::Owner).unwrap().lamports;
        let avg_cost_of_posting_vaa = 10_000_000;

        assert!(
            shim_owner_balance_change >= shimless_owner_balance_change.saturating_sub(avg_cost_of_posting_vaa),
            "Shim owner balance change should be greater than or equal to shimless owner balance change. Shim: {:?}, Shimless {:?}",
            shim_owner_balance_change,
            shimless_owner_balance_change
        );
        assert_eq!(
            shimless.get(&TestingActorEnum::Solver(0)).unwrap().usdc,
            shim.get(&TestingActorEnum::Solver(0)).unwrap().usdc,
            "Solver 0 balance change should be the same for both shim and shimless"
        );
    }
}
