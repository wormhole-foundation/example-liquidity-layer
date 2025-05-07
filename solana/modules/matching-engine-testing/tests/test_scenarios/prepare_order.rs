#![allow(clippy::expect_used)]
#![allow(clippy::panic)]

//! # Prepare order response instruction testing
//!
//! This module contains tests for the prepare order response instructions.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//!
//! - `test_prepare_order_shim_fallback` - Test that the prepare order shim fallback instruction works correctly
//! - `test_prepare_order_shimless` - Test that the prepare order shimless instruction works correctly
//!
//! ### Sad path tests
//!
//! - `test_prepare_order_response_shimless_blocks_shimful` - Test that the prepare order response shimless instruction blocks the shimful instruction
//! - `test_prepare_order_response_shimful_blocks_shimless` - Test that the prepare order response shimful instruction blocks the shimless instruction
//!

use crate::test_scenarios::execute_order::{execute_order_helper, ShimExecutionMode};
use crate::test_scenarios::make_offer::place_initial_offer_shim;
use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig,
    PrepareOrderResponseInstructionConfig,
};
use crate::utils::public_keys::ChainAddress;
use crate::utils::{self, Chain};

use matching_engine::error::MatchingEngineError;
use ruint::aliases::U256;
use solana_program_test::tokio;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::transaction::TransactionError;
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::vaa::VaaArgs;

use super::make_offer::reopen_fast_market_order_shim;

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

/// Test that the prepare order shim instruction works correctly (from ethereum to arbitrum)
#[tokio::test]
pub async fn test_prepare_order_shimful() {
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
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the prepare order shimless instruction works correctly (from ethereum to arbitrum)
#[tokio::test]
pub async fn test_prepare_order_shimless() {
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
        InstructionTrigger::PrepareOrderShimless(PrepareOrderResponseInstructionConfig::default()),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that prepare order response shim works after executing order shimlessly
#[tokio::test]
pub async fn test_prepare_order_response_shim_after_execute_order_shimless() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (execute_order_state, mut test_context, testing_engine) = Box::pin(execute_order_helper(
        ExecuteOrderInstructionConfig::default(),
        ShimExecutionMode::Shimless,
        None,
        transfer_direction,
    ))
    .await;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(execute_order_state),
        )
        .await;
}

/// Test that prepare order response shimless works after executing order shimlessly
#[tokio::test]
pub async fn test_prepare_order_response_shimless_after_execute_order_shim() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (execute_order_state, mut test_context, testing_engine) = Box::pin(execute_order_helper(
        ExecuteOrderInstructionConfig::default(),
        ShimExecutionMode::Shim,
        Some(vec![VaaArgs {
            post_vaa: true,
            ..VaaArgs::default()
        }]),
        transfer_direction,
    ))
    .await;
    let instruction_triggers = vec![InstructionTrigger::PrepareOrderShimless(
        PrepareOrderResponseInstructionConfig::default(),
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(execute_order_state),
        )
        .await;
}

/// Test prepare order response shim after reopening fast market order account in between offer and execute order
#[tokio::test]
pub async fn test_prepare_order_response_shim_after_reopening_fast_market_order_account() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let reopen_fast_market_order_state = Box::pin(reopen_fast_market_order_shim(
        place_initial_offer_state,
        &mut test_context,
        &testing_engine,
        None,
    ))
    .await;
    let instruction_triggers = vec![
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(reopen_fast_market_order_state),
        )
        .await;
}

/// Test that prepare order response shim works after reopening fast market order after place initial offer AND execute order
#[tokio::test]
pub async fn test_prepare_order_response_shim_after_reopening_fast_market_order_account_after_execute_order_and_place_initial_offer(
) {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let reopen_fast_market_order_state = Box::pin(reopen_fast_market_order_shim(
        place_initial_offer_state,
        &mut test_context,
        &testing_engine,
        None,
    ))
    .await;
    let instruction_triggers = vec![InstructionTrigger::ExecuteOrderShim(
        ExecuteOrderInstructionConfig::default(),
    )];
    let execute_order_state = testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(reopen_fast_market_order_state),
        )
        .await;
    let second_solver_keypair = testing_engine
        .testing_context
        .testing_actors
        .solvers
        .get(1)
        .unwrap()
        .clone()
        .keypair();
    let third_solver_pubkey = &testing_engine
        .testing_context
        .testing_actors
        .solvers
        .get(2)
        .unwrap()
        .pubkey();
    let reopen_config = InitializeFastMarketOrderShimInstructionConfig {
        fast_market_order_id: 2,
        close_account_refund_recipient: Some(*third_solver_pubkey),
        ..InitializeFastMarketOrderShimInstructionConfig::default()
    };
    let close_config = CloseFastMarketOrderShimInstructionConfig {
        close_account_refund_recipient_keypair: Some(second_solver_keypair),
        ..CloseFastMarketOrderShimInstructionConfig::default()
    };
    let double_reopen_fast_market_order_state = Box::pin(reopen_fast_market_order_shim(
        execute_order_state,
        &mut test_context,
        &testing_engine,
        Some((reopen_config, close_config)),
    ))
    .await;
    let instruction_triggers = vec![InstructionTrigger::PrepareOrderShim(
        PrepareOrderResponseInstructionConfig::default(),
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(double_reopen_fast_market_order_state),
        )
        .await;
}

/// Test prepare order response shim after custodian is paused after initial offer
#[tokio::test]
pub async fn test_prepare_order_response_shim_after_custodian_is_paused_after_initial_offer() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![
        InstructionTrigger::SetPauseCustodian(SetPauseCustodianInstructionConfig {
            is_paused: true,
            ..Default::default()
        }),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Prepare order response shim for completed auction after grace period
#[tokio::test]
pub async fn test_prepare_order_response_shim_for_completed_auction_after_grace_period() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    testing_engine
        .make_auction_passed_grace_period(&mut test_context, &place_initial_offer_state, 1)
        .await;
    let instruction_triggers = vec![
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig::default()),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Prepare order response shim for active auction
#[tokio::test]
pub async fn test_prepare_order_response_shim_within_auction_period() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            transfer_direction,
        ))
        .await;
    let instruction_triggers = vec![InstructionTrigger::PrepareOrderShim(
        PrepareOrderResponseInstructionConfig::default(),
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

/// Test that the prepare order response shimless instruction blocks the shimful instruction
#[tokio::test]
pub async fn test_prepare_order_response_shimless_blocks_shimful() {
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
        InstructionTrigger::PrepareOrderShimless(PrepareOrderResponseInstructionConfig::default()),
        // TODO: Figure out why this is failing on account already in use rather than the what happens the other way around above
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig {
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: TransactionError::AccountInUse.to_string(),
            }),
            ..PrepareOrderResponseInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the prepare order response shimful instruction blocks the shimless instruction
#[tokio::test]
pub async fn test_prepare_order_response_shimful_blocks_shimless() {
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
        InstructionTrigger::PrepareOrderShimless(PrepareOrderResponseInstructionConfig {
            expected_log_messages: Some(vec![ExpectedLog {
                log_message: "Already prepared".to_string(),
                count: 1,
            }]),
            ..PrepareOrderResponseInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Cannot prepare order response with emitter chain mismatch
#[tokio::test]
pub async fn test_prepare_order_response_shim_emitter_chain_mismatch() {
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
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig {
            vaa_index: 0,
            ..ExecuteOrderInstructionConfig::default()
        }),
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig {
            vaa_index: 1,
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: "".to_string(),
            }),
            ..PrepareOrderResponseInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

#[tokio::test]
pub async fn test_prepare_order_response_shimless_emitter_chain_mismatch() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let vaa_args = vec![
        VaaArgs {
            post_vaa: true,
            ..VaaArgs::default()
        },
        VaaArgs {
            post_vaa: true,
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
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShimless(ExecuteOrderInstructionConfig {
            vaa_index: 0,
            ..ExecuteOrderInstructionConfig::default()
        }),
        InstructionTrigger::PrepareOrderShimless(PrepareOrderResponseInstructionConfig {
            vaa_index: 1,
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(MatchingEngineError::InvalidSourceRouter),
                error_string: "Invalid source router".to_string(),
            }),
            ..PrepareOrderResponseInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Cannot prepare order response with deposit cctp nonce mismatch
#[tokio::test]
pub async fn test_prepare_order_response_shim_deposit_cctp_nonce_mismatch() {
    let transfer_direction = TransferDirection::FromEthereumToArbitrum;
    let vaa_args = vec![
        VaaArgs {
            post_vaa: false,
            ..VaaArgs::default()
        },
        VaaArgs {
            post_vaa: false,
            sequence: Some(69),
            cctp_nonce: Some(16),
            create_deposit_and_fast_transfer_params:
                utils::vaa::CreateDepositAndFastTransferParams {
                    deposit_params: utils::vaa::CreateDepositParams {
                        amount: U256::from(10000),
                        base_fee: 10,
                    },
                    fast_transfer_params: utils::vaa::CreateFastTransferParams {
                        ..utils::vaa::CreateFastTransferParams {
                            amount_in: 100,
                            max_fee: 12,
                            init_auction_fee: 1,
                            ..utils::vaa::CreateFastTransferParams::default()
                        }
                    },
                },
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
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig::default()),
        InstructionTrigger::ExecuteOrderShim(ExecuteOrderInstructionConfig {
            vaa_index: 0,
            ..ExecuteOrderInstructionConfig::default()
        }),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig {
                fast_market_order_id: 1,
                vaa_index: 1,
                close_account_refund_recipient: Some(Pubkey::new_unique()),
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
        ),
        // TODO: Figure out if this is wrong. The cctp message is
        // It currently fails because no auction has been created on this account so therefore the custodian is not the authority
        // and therefore cannot prepare the order at the transfer instruction
        InstructionTrigger::PrepareOrderShim(PrepareOrderResponseInstructionConfig {
            vaa_index: 1,
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: "".to_string(),
            }),
            ..PrepareOrderResponseInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}
