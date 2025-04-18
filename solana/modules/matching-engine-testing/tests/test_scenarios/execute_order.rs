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

use std::collections::HashSet;

use crate::test_scenarios::make_offer::place_initial_offer_shimless;
use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig,
};
use crate::testing_engine::engine::{ExecutionChain, ExecutionTrigger, VerificationTrigger};
use crate::testing_engine::state::TestingEngineState;
use crate::utils::public_keys::ChainAddress;
use crate::utils::token_account::SplTokenEnum;
use crate::utils::{self, Chain};

use anchor_lang::error::ErrorCode;
use matching_engine::error::MatchingEngineError;
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
            Some(vec![VaaArgs {
                post_vaa: true,
                ..VaaArgs::default()
            }]),
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
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after grace period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(execute_order_config)];
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;

    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
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
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after grace period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
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

/// Test executing order shim after grace period with different executor
#[tokio::test]
pub async fn test_execute_order_shim_after_grace_period_with_different_executor() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after grace period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        actor_enum: TestingActorEnum::Solver(1),
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(execute_order_config)];
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;

    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test executing order shimless after grace period with different executor
#[tokio::test]
pub async fn test_execute_order_shimless_after_grace_period_with_different_executor() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after grace period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        actor_enum: TestingActorEnum::Solver(1),
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;

    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test executing order shim after grace period with initial offer token closed
#[tokio::test]
pub async fn test_execute_order_shim_after_grace_period_with_initial_offer_token_closed() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after grace period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        actor_enum: TestingActorEnum::Solver(1),
        ..ExecuteOrderInstructionConfig::default()
    };
    testing_engine
        .close_token_account(
            &mut test_context,
            &TestingActorEnum::Solver(0),
            &SplTokenEnum::Usdc,
        )
        .await;
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(execute_order_config)];
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;

    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: Some(HashSet::from([TestingActorEnum::Solver(0)])),
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test executing order shim after grace period with initial offer token closed
#[tokio::test]
pub async fn test_execute_order_shimless_after_grace_period_with_initial_offer_token_closed() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1) // 1 slots after grace period
        .await;
    // Close the token account of the initial offer
    testing_engine
        .close_token_account(
            &mut test_context,
            &TestingActorEnum::Solver(0),
            &SplTokenEnum::Usdc,
        )
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        actor_enum: TestingActorEnum::Solver(1),
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: Some(HashSet::from([TestingActorEnum::Solver(0)])),
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test execute order shim after auction passed penalty period
#[tokio::test]
pub async fn test_execute_order_shim_after_auction_passed_penalty_period() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_penalty_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after penalty period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        ..ExecuteOrderInstructionConfig::default()
    };
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
    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test execute order shimless after auction passed penalty period
#[tokio::test]
pub async fn test_execute_order_shimless_after_auction_passed_penalty_period() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_penalty_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after penalty period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test execute order shimless after auction passed penalty period, and executor != best offer
#[tokio::test]
pub async fn test_execute_order_shimless_after_auction_passed_penalty_period_and_executor_not_best_offer(
) {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_penalty_period(&mut test_context, &place_initial_offer_state, 1) // 1 slot after penalty period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        fast_forward_slots: 0,
        actor_enum: TestingActorEnum::Solver(1),
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let custodian_token_previous_balance = place_initial_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
        )
        .await;
}

/// Test execute order shimless initial offer token != best offer token
#[tokio::test]
pub async fn test_execute_order_shimless_after_penalty_period_initial_offer_token_not_best_offer_token(
) {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![InstructionTrigger::ImproveOfferShimless(
        ImproveOfferInstructionConfig {
            actor: TestingActorEnum::Solver(1),
            ..Default::default()
        },
    )];
    let improve_offer_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
    testing_engine
        .make_auction_passed_penalty_period(&mut test_context, &improve_offer_state, 1) // 1 slot after penalty period
        .await;
    let previous_state_balances = testing_engine
        .testing_context
        .get_balances(&mut test_context)
        .await;
    let execute_order_config = ExecuteOrderInstructionConfig {
        actor_enum: TestingActorEnum::Solver(0),
        ..ExecuteOrderInstructionConfig::default()
    };
    let executor_actor = execute_order_config
        .actor_enum
        .get_actor(&testing_engine.testing_context.testing_actors);
    let custodian_token_previous_balance = improve_offer_state
        .auction_state()
        .get_active_auction()
        .unwrap()
        .get_auction_custody_token_balance(&mut test_context)
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShimless(
        execute_order_config,
    )];
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(improve_offer_state),
        )
        .await;
    let verification_trigger =
        VerificationTrigger::VerifyBalances(Box::new(VerifyBalancesConfig {
            previous_state_balances,
            balance_changes_config: BalanceChangesConfig {
                actor: executor_actor,
                spl_token_enum: SplTokenEnum::Usdc,
                custodian_token_previous_balance,
            },
            closed_token_account_enums: None,
        }));
    let execution_chain = ExecutionChain::new(vec![ExecutionTrigger::Verification(Box::new(
        verification_trigger,
    ))]);
    testing_engine
        .execute(
            &mut test_context,
            execution_chain,
            Some(execute_order_state),
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
pub async fn test_execute_order_cannot_improve_offer_after_executing_order() {
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

/// Cannot execute order with incorrect emitter chain
#[tokio::test]
pub async fn test_execute_order_shim_emitter_chain_mismatch() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let vaa_args = vec![
        VaaArgs {
            post_vaa: false,
            ..VaaArgs::default()
        },
        VaaArgs {
            post_vaa: false,
            override_emitter_chain_and_address: Some(ChainAddress::from_registered_token_router(
                Chain::Arbitrum,
            )),
            ..VaaArgs::default()
        },
    ];
    let (testing_context, mut test_context) = setup_environment(
        ShimMode::VerifyAndPostSignature,
        transfer_direction,
        Some(vaa_args),
    )
    .await;
    let testing_engine = TestingEngine::new(testing_context).await;
    let initialise_first_fast_market_order_instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
    ];
    let initialise_first_fast_market_order_state = testing_engine
        .execute(
            &mut test_context,
            initialise_first_fast_market_order_instruction_triggers,
            None,
        )
        .await;
    let initialise_second_fast_market_order_instruction_triggers = vec![
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                fast_market_order_id: 1,
                vaa_index: 1,
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
    ];
    let initialise_second_fast_market_order_state = testing_engine
        .execute(
            &mut test_context,
            initialise_second_fast_market_order_instruction_triggers,
            Some(initialise_first_fast_market_order_state),
        )
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(
        ExecuteOrderInstructionConfig {
            vaa_index: 1,
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(MatchingEngineError::VaaMismatch),
                error_string: "AccountNotInitialized".to_string(),
            }),
            ..ExecuteOrderInstructionConfig::default()
        },
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(initialise_second_fast_market_order_state),
        )
        .await;
}

/// Cannot execute order shim before auction duration is over
#[tokio::test]
pub async fn test_execute_order_shim_before_auction_duration_is_over() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(
        ExecuteOrderInstructionConfig {
            fast_forward_slots: 0,
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(MatchingEngineError::AuctionPeriodNotExpired),
                error_string: "AuctionPeriodNotExpired".to_string(),
            }),
            ..ExecuteOrderInstructionConfig::default()
        },
    )];
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
    vaa_args: Option<Vec<VaaArgs>>, // If none, then defaults for shimexecutionmode are used
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
