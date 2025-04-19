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
use crate::utils::auction::{ActiveAuctionState, AuctionAccounts};

use anchor_lang::error::ErrorCode;
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
    let vaa_args = vec![VaaArgs {
        post_vaa: false,
        ..VaaArgs::default()
    }];
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
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test settle auction works when custodian is paused
#[tokio::test]
pub async fn test_settle_auction_custodian_paused() {
    let (initial_state, mut test_context, testing_engine) = Box::pin(place_initial_offer_shim(
        PlaceInitialOfferInstructionConfig::default(),
        None,
        TransferDirection::FromEthereumToArbitrum,
    ))
    .await;

    let instruction_triggers = vec![
        InstructionTrigger::SetPauseCustodian(SetPauseCustodianInstructionConfig {
            is_paused: true,
            ..Default::default()
        }),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, Some(initial_state))
        .await;
}

/// Test that the settle auction instruction works with reopened fast market order
#[tokio::test]
pub async fn test_settle_auction_reopened_fast_market_order() {
    let (initial_state, mut test_context, testing_engine) = Box::pin(place_initial_offer_shim(
        PlaceInitialOfferInstructionConfig::default(),
        Some(vec![VaaArgs::default()]),
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
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
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

/// Test settle auction prepare order before active auction
#[tokio::test]
pub async fn test_settle_auction_prepare_order_before_active_auction() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vec![VaaArgs::default()]),
    )
    .await;
    let testing_engine = TestingEngine::new(testing_context).await;

    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
    ];
    let create_cctp_router_endpoints_state = testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;

    // This is just needed to get the router endpoint accounts when prepare order happens before place initial offer, it is not used for anything else
    let fake_auction_accounts = AuctionAccounts::fake_auction_accounts(
        &create_cctp_router_endpoints_state,
        &testing_engine.testing_context,
    );
    let instruction_triggers = vec![
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig {
            overwrite_auction_accounts: Some(fake_auction_accounts),
            ..Default::default()
        }),
    ];
    let prepared_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(create_cctp_router_endpoints_state),
        )
        .await;

    let instruction_triggers = vec![
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(prepared_order_state),
        )
        .await;
}

/// Test settle auction with base_fee_token != best offer actor
#[tokio::test]
pub async fn test_settle_auction_base_fee_token_not_best_offer_actor() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;

    let instruction_triggers = vec![
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig {
            actor_enum: TestingActorEnum::Solver(2),
            ..Default::default()
        }),
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
}

/*
                    Sad path tests section

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
**                                                     **
**                                                     **
**                                                     **
 **                   ************                   **
  **               ******      ******               **
   ***           *****            *****            ***
     **        ***                    ***         **
      ***    **                         **      ***
        ****                                 ****
           ****                           ****
               ******               ******
                    *****************
*/

/// Test cannot settle non-existent auction
#[tokio::test]
pub async fn test_settle_auction_non_existent() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vec![VaaArgs::default()]),
    )
    .await;
    let testing_engine = TestingEngine::new(testing_context).await;

    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
    ];
    let create_cctp_router_endpoints_state = testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;

    let fake_auction_accounts = AuctionAccounts::fake_auction_accounts(
        &create_cctp_router_endpoints_state,
        &testing_engine.testing_context,
    );
    let fake_active_auction_state =
        ActiveAuctionState::fake_active_auction_state(&fake_auction_accounts);
    let instruction_triggers = vec![
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig {
            overwrite_auction_accounts: Some(fake_auction_accounts),
            ..Default::default()
        }),
        InstructionTrigger::SettleAuction(SettleAuctionInstructionConfig {
            overwrite_active_auction_state: Some(fake_active_auction_state),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(ErrorCode::AccountNotInitialized),
                error_string: "AccountNotInitialized".to_string(),
            }),
            ..SettleAuctionInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(create_cctp_router_endpoints_state),
        )
        .await;
}

/*
Helper code
*/
mod helpers {
    use super::*;

    pub async fn balance_changes_shim() -> BalanceChanges {
        let transfer_direction = TransferDirection::FromEthereumToArbitrum;
        let vaa_args = vec![VaaArgs {
            post_vaa: false,
            ..VaaArgs::default()
        }];
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
            InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
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
        let vaa_args = vec![VaaArgs {
            post_vaa: true,
            ..VaaArgs::default()
        }];
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
            InstructionTrigger::PrepareOrderShimless(
                PrepareOrderResponseInstructionConfig::default(),
            ),
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
