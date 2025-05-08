#![allow(clippy::expect_used)]
#![allow(clippy::panic)]
// TODO:
// Test that auction is expired means that you cannot place offer or execute it

//! # Place initial offer and improve offer instruction testing
//!
//! This module contains tests for the place initial offer and improve offer instructions.
//!
//! ## Test Cases
//!
//! ### Happy path tests
//!
//! - `test_place_initial_offer_fallback` - Test that the place initial offer fallback instruction works correctly
//!
//! ### Sad path tests
//!
//! - `test_place_initial_offer_fails_if_fast_market_order_not_created` - Test that the place initial offer fails if the fast market order is not created
//!
use crate::testing_engine;
use crate::testing_engine::config::{
    InitializeInstructionConfig, PlaceInitialOfferInstructionConfig,
};
use crate::testing_engine::engine::CombinationTrigger;
use crate::testing_engine::state::TestingEngineState;
use crate::utils;
use crate::utils::auction::compare_auctions;
use crate::utils::token_account::SplTokenEnum;
use crate::utils::vaa::{
    CreateDepositAndFastTransferParams, CreateDepositParams, CreateFastTransferParams,
};

use anchor_lang::error::ErrorCode;
use anchor_lang::AccountDeserialize;
use matching_engine::error::MatchingEngineError;
use matching_engine::state::{Auction, AuctionParameters};
use solana_program_test::{tokio, ProgramTestContext};
use solana_sdk::transaction::TransactionError;
use testing_engine::config::*;
use testing_engine::engine::{InstructionTrigger, TestingEngine};
use testing_engine::setup::{setup_environment, ShimMode, TransferDirection};
use utils::vaa::VaaArgs;

// Define a constant transfer direction for the tests
const TRANSFER_DIRECTION: TransferDirection = TransferDirection::FromEthereumToArbitrum;

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

/// Test that the place initial offer shim instruction works correctly from arbitrum to ethereum
#[tokio::test]
pub async fn test_place_initial_offer_shimful() {
    let config = PlaceInitialOfferInstructionConfig::default();
    let (final_state, _, _) =
        Box::pin(place_initial_offer_shim(config, None, TRANSFER_DIRECTION)).await;
    assert_eq!(
        final_state
            .fast_market_order()
            .unwrap()
            .fast_market_order
            .digest(),
        final_state
            .base()
            .vaas
            .first()
            .unwrap()
            .fast_transfer_vaa
            .get_vaa_data()
            .digest()
    );
}

/// Test that the place initial offer instruction works correctly without the shim instructions
#[tokio::test]
pub async fn test_place_initial_offer_shimless() {
    let config = PlaceInitialOfferInstructionConfig::default();
    let (_final_state, _, _) = Box::pin(place_initial_offer_shimless(
        config,
        None,
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Test that auction account is exactly the same when using shimless and fallback instructions
#[tokio::test]
pub async fn test_place_initial_offer_shimless_and_shim_auctions_are_identical() {
    let shimless_config = PlaceInitialOfferInstructionConfig {
        actor: TestingActorEnum::Owner,
        ..PlaceInitialOfferInstructionConfig::default()
    };
    let shim_config = PlaceInitialOfferInstructionConfig {
        actor: TestingActorEnum::Owner,
        ..PlaceInitialOfferInstructionConfig::default()
    };
    let (final_state_shimless, mut shimless_test_context, _) = Box::pin(
        place_initial_offer_shimless(shimless_config, None, TRANSFER_DIRECTION),
    )
    .await;
    let (final_state_fallback, mut fallback_test_context, _) = Box::pin(place_initial_offer_shim(
        shim_config,
        None,
        TRANSFER_DIRECTION,
    ))
    .await;

    let shimless_auction = {
        let shimless_active_auction_address = final_state_shimless
            .auction_state()
            .get_active_auction()
            .unwrap()
            .auction_address;
        let shimless_auction_account_data = shimless_test_context
            .banks_client
            .get_account(shimless_active_auction_address)
            .await
            .unwrap()
            .unwrap()
            .data;
        Auction::try_deserialize(&mut &shimless_auction_account_data[..]).unwrap()
    };
    let shimful_auction = {
        let shimful_active_auction_address = final_state_fallback
            .auction_state()
            .get_active_auction()
            .unwrap()
            .auction_address;
        let shimful_account_data = fallback_test_context
            .banks_client
            .get_account(shimful_active_auction_address)
            .await
            .unwrap()
            .unwrap()
            .data;
        Auction::try_deserialize(&mut &shimful_account_data[..]).unwrap()
    };
    compare_auctions(&shimless_auction, &shimful_auction).await;
}

/// Test place initial offer shim and then improve the offer (shimless)
#[tokio::test]
pub async fn test_place_initial_offer_shim_and_improve_offer_shimless() {
    let config = PlaceInitialOfferInstructionConfig::default();
    let (place_initial_offer_state, mut test_context, testing_engine) = Box::pin(
        place_initial_offer_shimless(config, None, TRANSFER_DIRECTION),
    )
    .await;
    let improve_offer_config = ImproveOfferInstructionConfig::default();
    let instruction_triggers = vec![InstructionTrigger::ImproveOfferShimless(
        improve_offer_config,
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
}

/// Test that place initial offer and create fast market order can be done in one transaction
#[tokio::test]
pub async fn test_place_initial_offer_and_create_fast_market_order_in_one_transaction() {
    let config = Box::new(CombinedInstructionConfig::create_fast_market_order_and_place_initial_offer());
    let vaa_args = 
        vec![VaaArgs {
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
    let initialize_instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
    ];
    let initial_state = testing_engine.execute(&mut test_context, initialize_instruction_triggers, None).await;
    let instruction_triggers = vec![CombinationTrigger::CreateFastMarketOrderAndPlaceInitialOffer(config)];
    testing_engine.execute(&mut test_context, instruction_triggers, Some(initial_state)).await;
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

/// Test that the shimless place initial offer instruction blocks the shim instruction
#[tokio::test]
pub async fn test_place_initial_offer_shimless_blocks_shim() {
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
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(0),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(1),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: TransactionError::AccountInUse.to_string(),
            }),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
    ];
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test that the place initial offer shim blocks the non shim instruction
#[tokio::test]
pub async fn test_place_initial_offer_shim_blocks_shimless() {
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
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(0),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
        InstructionTrigger::PlaceInitialOfferShimless(PlaceInitialOfferInstructionConfig {
            actor: TestingActorEnum::Solver(1),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: 0,
                error_string: TransactionError::AccountInUse.to_string(),
            }),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
    ];

    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Test with usdt token account
#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_usdt_token_account() {
    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: 3, // Token spl transfer error code when mint does not match
        error_string: "Invalid argument".to_string(),
    };
    let config = PlaceInitialOfferInstructionConfig {
        spl_token_enum: SplTokenEnum::Usdt,
        expected_error: Some(expected_error),
        ..PlaceInitialOfferInstructionConfig::default()
    };
    Box::pin(place_initial_offer_shim(config, None, TRANSFER_DIRECTION)).await;
}

/// Test with usdt token account as custom account
#[tokio::test]
pub async fn test_place_initial_shim_offer_fails_usdt_mint_address() {
    let custom_accounts = PlaceInitialOfferCustomAccounts {
        mint_address: Some(crate::utils::constants::USDT_MINT),
        ..PlaceInitialOfferCustomAccounts::default()
    };
    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: u32::from(MatchingEngineError::InvalidMint), // Token spl transfer error code when mint does not match
        error_string: "Invalid mint".to_string(),
    };
    let config = PlaceInitialOfferInstructionConfig {
        custom_accounts: Some(custom_accounts),
        spl_token_enum: SplTokenEnum::Usdt,
        expected_error: Some(expected_error),
        ..PlaceInitialOfferInstructionConfig::default()
    };
    Box::pin(place_initial_offer_shim(config, None, TRANSFER_DIRECTION)).await;
}

/// Test that the place initial offer fails if the fast market order is not created
#[tokio::test]
pub async fn test_place_initial_offer_fails_if_fast_market_order_not_created() {
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
    let fake_fast_market_order_address = testing_context
        .get_vaa_pair(0)
        .unwrap()
        .fast_transfer_vaa
        .vaa_pubkey;
    let instruction_triggers = vec![
        InstructionTrigger::InitializeProgram(InitializeInstructionConfig::default()),
        InstructionTrigger::CreateCctpRouterEndpoints(
            CreateCctpRouterEndpointsInstructionConfig::default(),
        ),
        InstructionTrigger::InitializeFastMarketOrderShim(
            InitializeFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::PlaceInitialOfferShim(PlaceInitialOfferInstructionConfig {
            fast_market_order_address: OverwriteCurrentState::Some(fake_fast_market_order_address),
            expected_error: Some(ExpectedError {
                instruction_index: 0,
                error_code: u32::from(ErrorCode::ConstraintOwner),
                error_string: "Fast market order account owner is invalid".to_string(),
            }),
            ..PlaceInitialOfferInstructionConfig::default()
        }),
    ];

    let testing_engine = TestingEngine::new(testing_context).await;
    testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
}

/// Place initial offer shim fails when Offer > Max fee
#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_when_offer_greater_than_max_fee() {
    let amount_in = 123456789_u64;
    let (vaa_args, mut initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(111111111),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_add(1),
        post_vaa: false,
    }
    .create_vaa_args_and_initial_offer_config();

    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: u32::from(MatchingEngineError::OfferPriceTooHigh),
        error_string: "Offer price is greater than max fee".to_string(),
    };
    initial_offer_config.expected_error = Some(expected_error);
    Box::pin(place_initial_offer_shim(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Place initial offer shim fails when amount in is u64::max
#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_when_amount_in_is_u64_max() {
    let amount_in = u64::MAX;
    let (vaa_args, mut initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(i32::MAX),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1),
        post_vaa: false,
    }
    .create_vaa_args_and_initial_offer_config();

    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: u32::from(MatchingEngineError::U64Overflow),
        error_string: "U64Overflow".to_string(),
    };
    initial_offer_config.expected_error = Some(expected_error);
    Box::pin(place_initial_offer_shim(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Place initial offer shim fails when max fee and amount in sum to u64::max
#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_when_max_fee_and_amount_in_sum_to_u64_max() {
    let amount_in = u64::MAX.saturating_div(2).saturating_add(1);
    let (vaa_args, mut initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(2),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(111111111),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_div(2),
        post_vaa: false,
    }
    .create_vaa_args_and_initial_offer_config();

    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: u32::from(MatchingEngineError::U64Overflow),
        error_string: "U64Overflow".to_string(),
    };
    initial_offer_config.expected_error = Some(expected_error);

    Box::pin(place_initial_offer_shim(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Test place initial offer shim fails when vaa is expired
#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_when_vaa_is_expired() {
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
    ];
    let initialse_fast_market_order_state = testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;
    testing_engine
        .make_fast_transfer_vaa_expired(&mut test_context, 60) // 1 minute after expiry
        .await;

    let place_initial_offer_config = PlaceInitialOfferInstructionConfig {
        expected_error: Some(ExpectedError {
            instruction_index: 0,
            error_code: u32::from(MatchingEngineError::FastMarketOrderExpired),
            error_string: "Fast market order has expired".to_string(),
        }),
        ..PlaceInitialOfferInstructionConfig::default()
    };

    let instruction_triggers = vec![InstructionTrigger::PlaceInitialOfferShim(
        place_initial_offer_config,
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(initialse_fast_market_order_state),
        )
        .await;
}

#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_custodian_is_paused() {
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
    ];
    let initial_state = testing_engine
        .execute(&mut test_context, instruction_triggers, None)
        .await;

    let pause_custodian_config = SetPauseCustodianInstructionConfig {
        is_paused: true,
        ..Default::default()
    };
    let instruction_triggers = vec![InstructionTrigger::SetPauseCustodian(
        pause_custodian_config,
    )];
    let paused_state = testing_engine
        .execute(&mut test_context, instruction_triggers, Some(initial_state))
        .await;

    let place_initial_offer_config = PlaceInitialOfferInstructionConfig {
        expected_error: Some(ExpectedError {
            instruction_index: 0,
            error_code: u32::from(MatchingEngineError::Paused),
            error_string: "Fast market order account owner is invalid".to_string(),
        }),
        ..PlaceInitialOfferInstructionConfig::default()
    };
    let instruction_triggers = vec![InstructionTrigger::PlaceInitialOfferShim(
        place_initial_offer_config,
    )];
    testing_engine
        .execute(&mut test_context, instruction_triggers, Some(paused_state))
        .await;
}

/// Test place initial offer shim fails back to back
#[tokio::test]
pub async fn test_place_initial_offer_shim_fails_back_to_back() {
    let (initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            TRANSFER_DIRECTION,
        ))
        .await;

    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: 0,
        error_string: "Already in use".to_string(),
    };
    let place_initial_offer_config = PlaceInitialOfferInstructionConfig {
        expected_error: Some(expected_error),
        ..PlaceInitialOfferInstructionConfig::default()
    };
    let instruction_triggers = vec![InstructionTrigger::PlaceInitialOfferShim(
        place_initial_offer_config,
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(initial_offer_state),
        )
        .await;
}

/// Test place initial offer shim fails back to back
#[tokio::test]
pub async fn test_place_initial_offer_shimless_fails_back_to_back() {
    let (initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shimless(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            TRANSFER_DIRECTION,
        ))
        .await;

    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: 0,
        error_string: "Already in use".to_string(),
    };
    let place_initial_offer_config = PlaceInitialOfferInstructionConfig {
        expected_error: Some(expected_error),
        ..PlaceInitialOfferInstructionConfig::default()
    };
    let instruction_triggers = vec![InstructionTrigger::PlaceInitialOfferShimless(
        place_initial_offer_config,
    )];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(initial_offer_state),
        )
        .await;
}

/// Test that improved offer fails when improvement is too small
#[tokio::test]
pub async fn test_improve_offer_shim_fails_carping() {
    let amount_in = 123456789_u64;
    let (vaa_args, initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(111111111),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1),
        post_vaa: false,
    }
    .create_vaa_args_and_initial_offer_config();

    let (initial_offer_state, mut test_context, testing_engine) = Box::pin(
        place_initial_offer_shim(initial_offer_config, Some(vaa_args), TRANSFER_DIRECTION),
    )
    .await;

    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: u32::from(MatchingEngineError::CarpingNotAllowed),
        error_string: "Carping not allowed".to_string(),
    };

    let improve_offer_config = ImproveOfferInstructionConfig {
        offer_price: amount_in.saturating_sub(1),
        expected_error: Some(expected_error),
        ..ImproveOfferInstructionConfig::default()
    };
    let instruction_triggers = vec![InstructionTrigger::ImproveOfferShimless(
        improve_offer_config,
    )];

    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(initial_offer_state),
        )
        .await;
}

/// Test that improved offer fails when improvement is too small after an allowed improvement
#[tokio::test]
pub async fn test_improve_offer_shim_fails_carping_second_improvement() {
    let amount_in = 123456789_u64;
    let (vaa_args, initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(111111111),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1),
        post_vaa: false,
    }
    .create_vaa_args_and_initial_offer_config();

    let (initial_offer_state, mut test_context, testing_engine) = Box::pin(
        place_initial_offer_shim(initial_offer_config, Some(vaa_args), TRANSFER_DIRECTION),
    )
    .await;
    let new_offer_price = amount_in.saturating_sub(1).saturating_div(2);
    let improve_offer_config = ImproveOfferInstructionConfig {
        offer_price: new_offer_price,
        expected_error: None,
        ..ImproveOfferInstructionConfig::default()
    };
    let expected_error = ExpectedError {
        instruction_index: 0,
        error_code: u32::from(MatchingEngineError::CarpingNotAllowed),
        error_string: "Carping not allowed".to_string(),
    };
    let improve_offer_config_2 = ImproveOfferInstructionConfig {
        offer_price: new_offer_price.saturating_sub(1),
        expected_error: Some(expected_error),
        ..ImproveOfferInstructionConfig::default()
    };
    let instruction_triggers = vec![
        InstructionTrigger::ImproveOfferShimless(improve_offer_config),
        InstructionTrigger::ImproveOfferShimless(improve_offer_config_2),
    ];

    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(initial_offer_state),
        )
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

/// Test place initial offer shim when Offer == Max fee; Max fee == Amount in minus 1
#[tokio::test]
pub async fn test_place_initial_offer_shim_when_offer_equals_max_fee() {
    let amount_in = 123456789_u64;
    let (vaa_args, initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1), // Equal to amount in in minus 1
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(111111111),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1), // Equal to max fee
        post_vaa: false,
    }
    .create_vaa_args_and_initial_offer_config();

    Box::pin(place_initial_offer_shim(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Test place initial offer shimless when Offer == Max fee; Max fee == Amount in minus 1
#[tokio::test]
pub async fn test_place_initial_offer_shimless_when_offer_equals_max_fee() {
    let amount_in = 123456789_u64;
    let (vaa_args, initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1), // Equal to amount in in minus 1
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from(111111111),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1), // Equal to max fee
        post_vaa: true,
    }
    .create_vaa_args_and_initial_offer_config();

    Box::pin(place_initial_offer_shimless(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Test place initial offer shim when deposit amount == u256::MAX
#[tokio::test]
pub async fn test_place_initial_offer_shim_when_deposit_amount_is_u256_max() {
    let amount_in = 123456789_u64;
    let be_deposit_bytes: [u8; 32] = [
        u64::MAX.to_be_bytes(),
        u64::MAX.to_be_bytes(),
        u64::MAX.to_be_bytes(),
        u64::MAX.to_be_bytes(),
    ]
    .concat()
    .try_into()
    .unwrap();
    let (vaa_args, initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from_be_bytes(be_deposit_bytes),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1),
        post_vaa: true,
    }
    .create_vaa_args_and_initial_offer_config();

    Box::pin(place_initial_offer_shim(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

/// Test place initial offer shimless when deposit amount == u256::MAX
#[tokio::test]
pub async fn test_place_initial_offer_shimless_when_deposit_amount_is_u256_max() {
    let amount_in = 123456789_u64;
    let be_deposit_bytes: [u8; 32] = [
        u64::MAX.to_be_bytes(),
        u64::MAX.to_be_bytes(),
        u64::MAX.to_be_bytes(),
        u64::MAX.to_be_bytes(),
    ]
    .concat()
    .try_into()
    .unwrap();
    let (vaa_args, initial_offer_config) = TestAuctionSetup {
        amount_in,
        min_amount_out: amount_in.saturating_sub(5),
        max_fee: amount_in.saturating_sub(1),
        init_auction_fee: amount_in.saturating_div(3),
        deposit_amount: ruint::aliases::U256::from_be_bytes(be_deposit_bytes),
        deposit_base_fee: amount_in.saturating_div(4),
        offer_price: amount_in.saturating_sub(1),
        post_vaa: true,
    }
    .create_vaa_args_and_initial_offer_config();

    Box::pin(place_initial_offer_shimless(
        initial_offer_config,
        Some(vaa_args),
        TRANSFER_DIRECTION,
    ))
    .await;
}

#[tokio::test]
pub async fn test_improve_offer_after_close_fast_market_order() {
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            TRANSFER_DIRECTION,
        ))
        .await;
    let instruction_triggers = vec![
        InstructionTrigger::CloseFastMarketOrderShim(
            CloseFastMarketOrderShimInstructionConfig::default(),
        ),
        InstructionTrigger::ImproveOfferShimless(ImproveOfferInstructionConfig::default()),
    ];
    testing_engine
        .execute(
            &mut test_context,
            instruction_triggers,
            Some(place_initial_offer_state),
        )
        .await;
}

#[tokio::test]
pub async fn test_improve_offer_after_reopen_fast_market_order() {
    let (place_initial_offer_state, mut test_context, testing_engine) =
        Box::pin(place_initial_offer_shim(
            PlaceInitialOfferInstructionConfig::default(),
            None,
            TRANSFER_DIRECTION,
        ))
        .await;
    let reopen_fast_market_order_state = Box::pin(reopen_fast_market_order_shim(
        place_initial_offer_state,
        &mut test_context,
        &testing_engine,
        None,
    ))
    .await;
    let improve_offer_trigger = vec![InstructionTrigger::ImproveOfferShimless(
        ImproveOfferInstructionConfig::default(),
    )];
    testing_engine
        .execute(
            &mut test_context,
            improve_offer_trigger,
            Some(reopen_fast_market_order_state),
        )
        .await;
}

/*
================================================================================
Helper structs and functions
================================================================================
*/

pub async fn place_initial_offer_shim(
    config: PlaceInitialOfferInstructionConfig,
    vaa_args: Option<Vec<VaaArgs>>,
    transfer_direction: TransferDirection,
) -> (TestingEngineState, ProgramTestContext, TestingEngine) {
    let vaa_args = vaa_args.unwrap_or_else(|| {
        vec![VaaArgs {
            post_vaa: false,
            ..VaaArgs::default()
        }]
    });
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
        InstructionTrigger::PlaceInitialOfferShim(config),
    ];

    (
        testing_engine
            .execute(&mut test_context, instruction_triggers, None)
            .await,
        test_context,
        testing_engine,
    )
}

pub async fn place_initial_offer_shimless(
    config: PlaceInitialOfferInstructionConfig,
    vaa_args: Option<Vec<VaaArgs>>,
    transfer_direction: TransferDirection,
) -> (TestingEngineState, ProgramTestContext, TestingEngine) {
    let vaa_args = vaa_args.unwrap_or_else(|| {
        vec![VaaArgs {
            post_vaa: true,
            ..VaaArgs::default()
        }]
    });
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
        InstructionTrigger::PlaceInitialOfferShimless(config),
    ];
    (
        testing_engine
            .execute(&mut test_context, instruction_triggers, None)
            .await,
        test_context,
        testing_engine,
    )
}

pub async fn reopen_fast_market_order_shim(
    initial_state: TestingEngineState,
    test_context: &mut ProgramTestContext,
    testing_engine: &TestingEngine,
    configs: Option<(
        InitializeFastMarketOrderShimInstructionConfig,
        CloseFastMarketOrderShimInstructionConfig,
    )>,
) -> TestingEngineState {
    // If no configs are provided, assume its the first reopening
    let (reopen_config, close_config) = configs.unwrap_or_else(|| {
        let correct_solver = &testing_engine
            .testing_context
            .testing_actors
            .solvers
            .get(1)
            .unwrap()
            .pubkey();
        (
            InitializeFastMarketOrderShimInstructionConfig {
                fast_market_order_id: 1,
                close_account_refund_recipient: Some(*correct_solver),
                ..InitializeFastMarketOrderShimInstructionConfig::default()
            },
            CloseFastMarketOrderShimInstructionConfig::default(),
        )
    });
    let instruction_triggers = vec![
        InstructionTrigger::CloseFastMarketOrderShim(close_config),
        InstructionTrigger::InitializeFastMarketOrderShim(reopen_config),
    ];

    testing_engine
        .execute(test_context, instruction_triggers, Some(initial_state))
        .await
}

/// A struct representing the auction info and its valid state
// TODO: Use this or something similar to fuzz test over various initial offers.
#[derive(Clone)]
pub struct TestAuctionSetup {
    pub amount_in: u64, // Must be small enough for security deposit to be less than u64::MAX
    pub min_amount_out: u64, // Not used for anything can be any value
    pub max_fee: u64,   // Must be greater than or equal to offer price
    pub init_auction_fee: u64, // Must be less than or equal to max fee
    pub deposit_amount: ruint::aliases::U256,
    pub deposit_base_fee: u64,
    pub offer_price: u64, // Must be less than or equal to max fee
    pub post_vaa: bool,   // Must be true for shimless tests
}

impl TestAuctionSetup {
    #[allow(dead_code)]
    pub fn calculate_security_deposit_notional(&self) -> u64 {
        let test_auction_parameters = AuctionParameters {
            user_penalty_reward_bps: 250000,
            initial_penalty_bps: 250000,
            duration: 2,
            grace_period: 5,
            penalty_period: 10,
            min_offer_delta_bps: 20000,
            security_deposit_base: 4200000,
            security_deposit_bps: 5000,
        };

        matching_engine::utils::auction::compute_notional_security_deposit(
            &test_auction_parameters,
            self.amount_in,
        )
    }

    pub fn create_vaa_args_and_initial_offer_config(
        &self,
    ) -> (Vec<VaaArgs>, PlaceInitialOfferInstructionConfig) {
        let create_deposit_and_fast_transfer_params = CreateDepositAndFastTransferParams {
            deposit_params: CreateDepositParams {
                amount: self.deposit_amount,
                base_fee: self.deposit_base_fee,
            },
            fast_transfer_params: CreateFastTransferParams {
                amount_in: self.amount_in,
                min_amount_out: self.amount_in,
                max_fee: self.max_fee,
                init_auction_fee: self.init_auction_fee,
            },
        };
        let vaa_args = vec![VaaArgs {
            post_vaa: self.post_vaa,
            create_deposit_and_fast_transfer_params,
            ..Default::default()
        }];
        let initial_offer_config = PlaceInitialOfferInstructionConfig {
            offer_price: self.offer_price,
            ..PlaceInitialOfferInstructionConfig::default()
        };
        (vaa_args, initial_offer_config)
    }
}
