//! # Create and close fast market order instruction testing
//!
//! This module contains tests for the create and close fast market order instructions.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//!
//! - `test_initialize_fast_market_order_fallback` - Test that the fast market order is initialized correctly
//! - `test_close_fast_market_order_fallback` - Test that the fast market order is closed correctly
//! - `test_close_fast_market_order_fallback_with_custom_refund_recipient` - Test that the fast market order is closed correctly with a custom refund recipient
//!
//! ### Sad path tests
//!
//! - `test_fast_market_order_cannot_be_refunded_by_someone_who_did_not_initialize_it` - Test that the fast market order cannot be refunded by someone who did not initialize it
//!
//! ### Edge case tests
//!
use crate::testing_engine;
use crate::utils;
use matching_engine::error::MatchingEngineError;
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

/// Test that the create fast market order account works correctly for the fallback instruction
#[tokio::test]
pub async fn test_initialize_fast_market_order_fallback() {
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

    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
    ];

    let testing_engine = TestingEngine::new(testing_context).await;
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the close fast market order account works correctly for the fallback instruction
#[tokio::test]
pub async fn test_close_fast_market_order_fallback() {
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
    let testing_engine = TestingEngine::new(testing_context).await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig::default(),
        ),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the close fast market order account works correctly for the fallback instruction
#[tokio::test]
pub async fn test_close_fast_market_order_fallback_with_custom_refund_recipient() {
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
    let solver_1 = &testing_context.testing_actors.solvers[1].clone();
    let solver_1_balance_before = solver_1.get_lamport_balance(&mut test_context).await;
    let testing_engine = TestingEngine::new(testing_context).await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                close_account_refund_recipient: Some(solver_1.pubkey()),
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
        InstructionTrigger::CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig {
            close_account_refund_recipient_keypair: Some(solver_1.keypair()),
            ..CloseFastMarketOrderShimInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
    let solver_1_balance_after = solver_1.get_lamport_balance(&mut test_context).await;
    assert!(
        solver_1_balance_after > solver_1_balance_before,
        "Solver 1 balance after is not greater than balance before"
    );
}

/*
                    Sad path tests Section

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

/// Test that the fast market order cannot be refunded by someone who did not initialize it
#[tokio::test]
pub async fn test_fast_market_order_cannot_be_refunded_by_someone_who_did_not_initialize_it() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
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
    let solver_0 = testing_context.testing_actors.solvers.first().unwrap();
    let solver_1 = testing_context.testing_actors.solvers.last().unwrap();

    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                close_account_refund_recipient: Some(solver_0.pubkey()),
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
        InstructionTrigger::CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig {
            close_account_refund_recipient_keypair: Some(solver_1.keypair()),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(MatchingEngineError::MismatchingCloseAccountRefundRecipient),
                error_string: "Fast market order account owner is invalid".to_string(),
            }),
            ..CloseFastMarketOrderShimInstructionConfig::default()
        }),
    ];

    let testing_engine = TestingEngine::new(testing_context).await;
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the same fast market order cannot be closed twice
#[tokio::test]
pub async fn test_fast_market_order_cannot_be_closed_twice() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
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
        InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig {
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 3001,
                error_string: "Fast market order account is already closed".to_string(),
            }),
            ..CloseFastMarketOrderShimInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}
/*
                                Edge case tests section
                                                                                       88
                                                                                       88
                                                                                       88
 ,adPPYba,  ,adPPYba, 8b,dPPYba,  ,adPPYba,  ,adPPYba,  8b,dPPYba,  ,adPPYba,  ,adPPYb,88
a8"     "" a8P_____88 88P'   `"8a I8[    "" a8"     "8a 88P'   "Y8 a8P_____88 a8"    `Y88
8b         8PP""""""" 88       88  `"Y8ba,  8b       d8 88         8PP""""""" 8b       88
"8a,   ,aa "8b,   ,aa 88       88 aa    ]8I "8a,   ,a8" 88         "8b,   ,aa "8a,   ,d88
 `"Ybbd8"'  `"Ybbd8"' 88       88 `"YbbdP"'  `"YbbdP"'  88          `"Ybbd8"'  `"8bbdP"Y8
*/

/// Test that fast market order can be opened after being closed by the same solver
#[tokio::test]
pub async fn test_fast_market_order_can_be_opened_after_being_closed_by_the_same_solver() {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
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
        InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that multiple fast market orders can be opened and closed by different solvers in arbitrary order
#[tokio::test]
pub async fn test_multiple_fast_market_orders_can_be_opened_and_closed_by_different_solvers_in_arbitrary_order(
) {
    let transfer_direction = TransferDirection::FromArbitrumToEthereum;
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
    let solver_1 = testing_context.testing_actors.solvers[1].clone();
    let solver_2 = testing_context.testing_actors.solvers[2].clone();
    let testing_engine = TestingEngine::new(testing_context).await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                fast_market_order_id: 0,
                close_account_refund_recipient: None, // Solver 0
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
    ];
    let current_state = testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
    let fast_market_order_0_pubkey = current_state
        .fast_market_order()
        .unwrap()
        .fast_market_order_address;
    let instruction_triggers_1 = vec![InstructionTrigger::InitializeFastMarketOrderShim(
        InitializeFastMarketOrderShimInstructionConfig {
            fast_market_order_id: 1,
            close_account_refund_recipient: Some(solver_1.pubkey()),
            ..InitializeFastMarketOrderShimInstructionConfig::default()
        },
    )];
    let current_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers_1,
            Some(current_state),
        )
        .await;
    let fast_market_order_1_pubkey = current_state
        .fast_market_order()
        .unwrap()
        .fast_market_order_address;
    let instruction_triggers_2 = vec![
        InstructionTrigger::CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig {
            fast_market_order_address: Some(fast_market_order_0_pubkey),
            ..CloseFastMarketOrderShimInstructionConfig::default()
        }),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                fast_market_order_id: 2,
                close_account_refund_recipient: Some(solver_2.pubkey()),
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
    ];
    let current_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers_2,
            Some(current_state),
        )
        .await;
    let fast_market_order_2_pubkey = current_state
        .fast_market_order()
        .unwrap()
        .fast_market_order_address;
    let instruction_triggers_3 = vec![
        InstructionTrigger::CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig {
            close_account_refund_recipient_keypair: Some(solver_2.keypair()),
            fast_market_order_address: Some(fast_market_order_2_pubkey),
            ..CloseFastMarketOrderShimInstructionConfig::default()
        }),
        InstructionTrigger::CloseFastMarketOrderShim(CloseFastMarketOrderShimInstructionConfig {
            close_account_refund_recipient_keypair: Some(solver_1.keypair()),
            fast_market_order_address: Some(fast_market_order_1_pubkey),
            ..CloseFastMarketOrderShimInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers_3,
            Some(current_state),
        )
        .await;
}
