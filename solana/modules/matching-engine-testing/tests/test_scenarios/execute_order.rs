// TODO:
// Shouldn't be able to improve offer after executing order
// Try within a grace period and after grace period to see if math checks out
// After grace period, try to execute order with different account to best offer to see if math checks out
// Check that the initial offer token being closed doesnt stop the execute order

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

use crate::test_scenarios::make_offer::place_initial_offer_shimless;
use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig,
};
use crate::testing_engine::engine::{
    fast_forward_slots, ExecutionChain, ExecutionTrigger, VerificationTrigger,
};
use crate::testing_engine::state::TestingEngineState;
use crate::utils;
use crate::utils::token_account::SplTokenEnum;

use anchor_lang::error::ErrorCode;
use solana_program_test::{tokio, ProgramTestContext};
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::vaa::VaaArgs;

use super::make_offer::place_initial_offer_shim;

/// Test that the execute order shim instruction works correctly
#[tokio::test]
// TODO: Flesh out this test to see if the message was posted correctly
pub async fn test_execute_order_shim() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    Box::pin(execute_order_helper(
        ExecuteOrderInstructionConfig::default(),
        ShimExecutionMode::Shim,
        None,
        transfer_direction,
    ))
    .await;
}

/// Test that the execute order shimless instruction works correctly
#[tokio::test]
pub async fn test_execute_order_shimless() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    Box::pin(execute_order_helper(
        ExecuteOrderInstructionConfig::default(),
        ShimExecutionMode::Shimless,
        None,
        transfer_direction,
    ))
    .await;
}

/// Test that reopening fast market order account and then executing order succeeds
#[tokio::test]
pub async fn test_execute_order_after_reopening_fast_market_order_account() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let testing_actors = &testing_engine.testing_context.testing_actors;
    // Get the second solver because the first one was used to set up the initial fast market order account
    let close_account_refund_recipient = testing_actors.solvers.get(1).unwrap().pubkey();
    let instruction_triggers = vec![
        InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                fast_market_order_id: 1,
                close_account_refund_recipient: Some(close_account_refund_recipient),
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
    ];
    let mut execution_chain = ExecutionChain::from(instruction_triggers);
    execution_chain.push(ExecutionTrigger::Verification(Box::new(
        VerificationTrigger::VerifyAuctionState(true),
    )));
    let _ = testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Test execute order shim after placing initial offer with shimless instruction
#[tokio::test]
pub async fn test_execute_order_shim_after_placing_initial_offer_with_shimless() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
    ];
    let mut execution_chain = ExecutionChain::from(instruction_triggers);
    execution_chain.push(ExecutionTrigger::Verification(Box::new(
        VerificationTrigger::VerifyAuctionState(true),
    )));
    let _ = testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Test execute order shimless after placing initial offer with shim instruction
#[tokio::test]
pub async fn test_execute_order_shimless_after_placing_initial_offer_with_shim() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            Some(VaaArgs {
                post_vaa: true,
                ..VaaArgs::default()
            }),
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        ExecuteOrderInstructionConfig::default(),
    )];
    let mut execution_chain = ExecutionChain::from(instruction_triggers);
    execution_chain.push(ExecutionTrigger::Verification(Box::new(
        VerificationTrigger::VerifyAuctionState(true),
    )));
    let _ = testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Test executing order shim after grace period
#[tokio::test]
pub async fn test_execute_order_shim_after_grace_period() {
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
    let instruction_vec = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
    ];
    let place_initial_offer_state = testing_engine
        .execute(&mut test_context, instruction_vec, None)
        .await;
    fast_forward_slots(&mut test_context, 100).await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig::default();
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(execute_order_config)];
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let active_auction_state = execute_order_state
        .auction_state()
        .get_active_auction()
        .unwrap();
    let executor_enum = execute_order_state.execute_order_actor().unwrap();
    let best_offer_enum = execute_order_state.best_offer_actor().unwrap();
    let initial_offer_enum = execute_order_state.initial_offer_placed_actor().unwrap();
    let execute_order_actor_enums = ExecuteOrderActorEnums {
        executor: executor_enum,
        best_offer: best_offer_enum,
        initial_offer: initial_offer_enum,
    };
    let verification_trigger = VerificationTrigger::VerifyBalances(VerifyBalancesConfig {
        previous_state_balances,
        balance_changes: BalanceChanges::execute_order_changes(
            &mut test_context,
            &execute_order_state,
            executor_actor,
            execute_order_actor_enums,
            active_auction_state,
            SplTokenEnum::Usdc,
        )
        .await,
    });
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    let _ = testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test executing order shimless after grace period
#[tokio::test]
pub async fn test_execute_order_shimless_after_grace_period() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    fast_forward_slots(&mut test_context, 100).await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig::default();
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let active_auction_state = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap();
    let executor_enum = TestingActorEnum::Solver(0);
    let best_offer_enum = TestingActorEnum::Solver(0);
    let initial_offer_enum = TestingActorEnum::Solver(0);
    let execute_order_actor_enums = ExecuteOrderActorEnums {
        executor: executor_enum,
        best_offer: best_offer_enum,
        initial_offer: initial_offer_enum,
    };

    let verification_trigger = VerificationTrigger::VerifyBalances(VerifyBalancesConfig {
        previous_state_balances,
        balance_changes: BalanceChanges::execute_order_changes(
            &mut test_context,
            &place_initial_offer_state,
            executor_actor,
            execute_order_actor_enums,
            active_auction_state,
            SplTokenEnum::Usdc,
        )
        .await,
    });
    let mut execution_chain = ExecutionChain::from(instruction_triggers);
    execution_chain.push(ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    )));
    let _ = testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Test executing order shim after custodian is paused after initial offer
#[tokio::test]
pub async fn test_execute_order_shim_after_custodian_is_paused_after_initial_offer() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![InstructionTrigger::SetPauseCustodian(
        SetPauseCustodianInstructionConfig {
            is_paused: true,
            ..Default::default()
        },
    )];
    let paused_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(
        ExecuteOrderInstructionConfig::default(),
    )];
    testing_engine
        .execute(&mut test_context, instruction_triggers, Some(paused_state))
        .await;
}

/// Test executing order shimless after custodian is paused after initial offer
#[tokio::test]
pub async fn test_execute_order_shimless_after_custodian_is_paused_after_initial_offer() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![InstructionTrigger::SetPauseCustodian(
        SetPauseCustodianInstructionConfig {
            is_paused: true,
            ..Default::default()
        },
    )];
    let paused_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        ExecuteOrderInstructionConfig::default(),
    )];
    testing_engine
        .execute(&mut test_context, instruction_triggers, Some(paused_state))
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

/// Test that the execute order shim instruction blocks the shimless instruction
#[tokio::test]
pub async fn test_execute_order_shim_blocks_shimless() {
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
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that execute order shim after close fast market order fails
#[tokio::test]
pub async fn test_execute_order_shim_after_close_fast_market_order_fails() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![
        InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::ImproveOfferShimless(ImproveOfferInstructionConfig::default()),
    ];
    let close_engines_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: 3001, // Account Discriminator not found
        error_string: "AccountDiscriminatorNotFound.".to_string(),
    };
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(
        ExecuteOrderInstructionConfig {
            expected_error: Some(expected_error),
            ..ExecuteOrderInstructionConfig::default()
        },
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(close_engines_state),
        )
        .await;
}

/// Cannot improve offer after executing order
#[tokio::test]
pub async fn test_cannot_improve_offer_after_executing_order() {
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
        InstructionTrigger::ImproveOfferShimless(ImproveOfferInstructionConfig {
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(ErrorCode::AccountNotInitialized),
                error_string: "AccountNotInitialized".to_string(),
            }),
            ..ImproveOfferInstructionConfig::default()
        }),
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
Helper code
 */

pub enum ShimExecutionMode {
    Shim,
    Shimless,
}

pub async fn execute_order_helper(
    config: ExecuteOrderInstructionConfig,
    shim_execution_mode: ShimExecutionMode,
    vaa_args: Option<VaaArgs>, // If none, then defaults for shimexecutionmode are used
    transfer_direction: TransferDirection,
) -> (TestingEngineState, ProgramTestContext, TestingEngine) {
    let (place_initial_offer_state, mut test_context, testing_engine) = match shim_execution_mode {
        ShimExecutionMode::Shim => {
            Box::pin(place_initial_offer_shim(
                PlaceInitialOfferInstructionConfig::default(),
                vaa_args,
                transfer_direction,
            ))
            .await
        }
        ShimExecutionMode::Shimless => {
            Box::pin(place_initial_offer_shimless(
                PlaceInitialOfferInstructionConfig::default(),
                vaa_args,
                transfer_direction,
            ))
            .await
        }
    };
    let instruction_triggers = match shim_execution_mode {
        ShimExecutionMode::Shim => vec![InstructionTrigger::ExecuteOrderShim(config)],
        ShimExecutionMode::Shimless => vec![InstructionTrigger::ExecuteOrderShimless(config)],
    };
    let mut execution_chain = ExecutionChain::from(instruction_triggers);
    execution_chain.push(ExecutionTrigger::Verification(Box::new(
        VerificationTrigger::VerifyAuctionState(true),
    )));
    (
        testing_engine
            .execute(
                &mut test_context,
                execution_chain,
                Some(place_initial_offer_state),
            )
            .await,
        test_context,
        testing_engine,
    )
}
