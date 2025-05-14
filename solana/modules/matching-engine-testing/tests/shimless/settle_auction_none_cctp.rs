use crate::testing_engine::config::{InstructionConfig, SettleAuctionNoneInstructionConfig};
use crate::testing_engine::setup::TestingContext;
use crate::testing_engine::state::{OrderPreparedState, TestingEngineState};
use crate::utils::auction::AuctionState;
use crate::utils::token_account::SplTokenEnum;
use anchor_lang::prelude::*;
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token;
use matching_engine::accounts::RequiredSysvars;
use matching_engine::accounts::{
    CheckedCustodian, ClosePreparedOrderResponse,
    SettleAuctionNoneCctp as SettleAuctionNoneCctpAccounts, WormholePublishMessage,
};
use matching_engine::instruction::SettleAuctionNoneCctp as SettleAuctionNoneCctpIx;
use matching_engine::state::{Auction, PreparedOrderResponse};
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Signer;
use solana_sdk::sysvar::SysvarId;
use solana_sdk::transaction::Transaction;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

use crate::shimful::shims_execute_order::create_cctp_deposit_for_burn;

/// Settle an auction none shimless
pub async fn settle_auction_none_shimless(
    testing_context: &TestingContext,
    current_state: &TestingEngineState,
    test_context: &mut ProgramTestContext,
    config: &SettleAuctionNoneInstructionConfig,
) -> AuctionState {
    let payer_signer = &config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let settle_auction_none_cctp_accounts = create_settle_auction_none_cctp_shimless_accounts(
        test_context,
        testing_context,
        current_state,
        config,
    )
    .await;
    let settle_auction_none_ix = Instruction {
        program_id: testing_context.get_matching_engine_program_id(),
        accounts: settle_auction_none_cctp_accounts.to_account_metas(None),
        data: SettleAuctionNoneCctpIx {}.data(),
    };
    let tx = Transaction::new_signed_with_payer(
        &[settle_auction_none_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        testing_context
            .get_new_latest_blockhash(test_context)
            .await
            .unwrap(),
    );

    testing_context
        .execute_and_verify_transaction(test_context, tx, config.expected_error())
        .await;
    if config.expected_error().is_some() {
        return current_state.auction_state().clone();
    }

    AuctionState::Settled(None)
}

async fn create_settle_auction_none_cctp_shimless_accounts(
    test_context: &mut ProgramTestContext,
    testing_context: &TestingContext,
    current_state: &TestingEngineState,
    config: &SettleAuctionNoneInstructionConfig,
) -> SettleAuctionNoneCctpAccounts {
    let payer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let order_prepared_state = current_state.order_prepared().unwrap();
    let OrderPreparedState {
        prepared_order_response_address,
        prepared_custody_token,
        base_fee_token: _,
        prepared_by,
        actor_enum: _,
    } = *order_prepared_state;

    let checked_custodian = CheckedCustodian {
        custodian: current_state.custodian_address().unwrap(),
    };

    let prepared_order_response_data = test_context
        .banks_client
        .get_account(prepared_order_response_address)
        .await
        .unwrap()
        .unwrap()
        .data;
    let prepared_order =
        PreparedOrderResponse::try_deserialize(&mut &prepared_order_response_data[..]).unwrap();
    let auction_seeds = &[
        Auction::SEED_PREFIX,
        &prepared_order.seeds.fast_vaa_hash.as_ref(),
    ];
    let (auction, _bump) = Pubkey::find_program_address(
        auction_seeds,
        &testing_context.get_matching_engine_program_id(),
    );
    let (core_message, _bump) = Pubkey::find_program_address(
        &[common::CORE_MESSAGE_SEED_PREFIX, &auction.as_ref()],
        &testing_context.get_matching_engine_program_id(),
    );

    let (cctp_message, _bump) = Pubkey::find_program_address(
        &[common::CCTP_MESSAGE_SEED_PREFIX, &auction.to_bytes()],
        &testing_context.get_matching_engine_program_id(),
    );
    let close_prepare_order_response = ClosePreparedOrderResponse {
        by: prepared_by,
        custody_token: prepared_custody_token,
        order_response: prepared_order_response_address,
    };
    let emitter_sequence = wormhole_svm_definitions::find_emitter_sequence_address(
        &checked_custodian.custodian,
        &wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID,
    )
    .0;
    let wormhole_publish_message = WormholePublishMessage {
        config: wormhole_svm_definitions::solana::CORE_BRIDGE_CONFIG,
        emitter_sequence,
        fee_collector: wormhole_svm_definitions::solana::CORE_BRIDGE_FEE_COLLECTOR,
        core_bridge_program: wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID,
    };

    let cctp = create_cctp_deposit_for_burn(current_state, testing_context);

    let sysvars = RequiredSysvars {
        clock: Clock::id(),
        rent: Rent::id(),
    };

    let event_authority = Pubkey::find_program_address(
        &[EVENT_AUTHORITY_SEED],
        &testing_context.get_matching_engine_program_id(),
    )
    .0;

    let spl_token_enum = current_state
        .spl_token_enum()
        .unwrap_or_else(|| SplTokenEnum::Usdc);
    let fee_recipient_token = testing_context
        .testing_actors
        .fee_recipient
        .token_account_address(&spl_token_enum)
        .unwrap();

    SettleAuctionNoneCctpAccounts {
        payer: payer.pubkey(),
        custodian: checked_custodian,
        fee_recipient_token,
        core_message,
        cctp_message,
        prepared: close_prepare_order_response,
        auction,
        wormhole: wormhole_publish_message,
        cctp,
        token_program: spl_token::ID,
        system_program: solana_program::system_program::ID,
        event_authority,
        program: testing_context.get_matching_engine_program_id(),
        sysvars,
    }
}
