use crate::testing_engine::config::ExpectedError;
use crate::testing_engine::config::SettleAuctionInstructionConfig;
use crate::testing_engine::setup::TestingContext;
use crate::testing_engine::state::OrderPreparedState;
use crate::testing_engine::state::TestingEngineState;
use crate::utils::auction::AuctionState;

use anchor_lang::prelude::*;
use anchor_lang::InstructionData;
use anchor_spl::token::spl_token;
use matching_engine::accounts::SettleAuctionComplete as SettleAuctionCompleteCpiAccounts;
use matching_engine::instruction::SettleAuctionComplete;
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

/// Settle an auction (shimless)
///
/// Settle an auction by providing a prepare order response address, prepared custody token, and expected error.
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The test context
/// * `payer_signer` - The payer signer
/// * `auction_state` - The auction state
/// * `prepare_order_response_address` - The prepare order response address
/// * `prepared_custody_token` - The prepared custody token
/// * `expected_error` - The expected error
///
/// # Returns
///
/// The new auction state if successful, otherwise the old auction state
pub async fn settle_auction_complete(
    testing_context: &TestingContext,
    current_state: &TestingEngineState,
    test_context: &mut ProgramTestContext,
    config: &SettleAuctionInstructionConfig,
    expected_error: Option<&ExpectedError>,
) -> TestingEngineState {
    let payer_signer = &config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let active_auction = config
        .overwrite_active_auction_state
        .as_ref()
        .unwrap_or_else(|| {
            current_state
                .auction_state()
                .get_active_auction()
                .expect("Failed to get active auction")
        });

    let order_prepared_state = current_state
        .order_prepared()
        .expect("Order prepared not found");
    let OrderPreparedState {
        prepared_order_response_address,
        prepared_custody_token,
        base_fee_token,
        actor_enum: _,
    } = *order_prepared_state;

    let matching_engine_program_id = testing_context.get_matching_engine_program_id();
    let event_seeds = EVENT_AUTHORITY_SEED;
    let event_authority =
        Pubkey::find_program_address(&[event_seeds], &matching_engine_program_id).0;
    let settle_auction_accounts = SettleAuctionCompleteCpiAccounts {
        beneficiary: payer_signer.pubkey(),
        base_fee_token,
        prepared_order_response: prepared_order_response_address,
        prepared_custody_token,
        auction: active_auction.auction_address,
        best_offer_token: active_auction.best_offer.offer_token,
        token_program: spl_token::ID,
        event_authority,
        program: matching_engine_program_id,
    };

    let settle_auction_complete_cpi = SettleAuctionComplete {};

    let settle_auction_complete_ix = Instruction {
        program_id: matching_engine_program_id,
        accounts: settle_auction_accounts.to_account_metas(Some(false)),
        data: settle_auction_complete_cpi.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[settle_auction_complete_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        testing_context
            .get_new_latest_blockhash(test_context)
            .await
            .unwrap(),
    );

    testing_context
        .execute_and_verify_transaction(test_context, tx, expected_error)
        .await;
    if expected_error.is_none() {
        TestingEngineState::AuctionSettled {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().unwrap().clone(),
            auction_state: AuctionState::Settled(Box::new(active_auction.clone())),
            fast_market_order: current_state.fast_market_order().cloned(),
            order_prepared: current_state.order_prepared().unwrap().clone(),
            auction_accounts: current_state.auction_accounts().cloned(),
            order_executed: current_state.order_executed().cloned(),
        }
    } else {
        current_state.clone()
    }
}
