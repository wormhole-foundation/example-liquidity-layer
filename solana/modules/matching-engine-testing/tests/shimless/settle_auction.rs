use crate::testing_engine::config::ExpectedError;
use crate::utils::auction::AuctionState;
use crate::utils::setup::TestingContext;

use anchor_lang::prelude::*;
use anchor_lang::InstructionData;
use anchor_spl::token::spl_token;
use matching_engine::accounts::SettleAuctionComplete as SettleAuctionCompleteCpiAccounts;
use matching_engine::instruction::SettleAuctionComplete;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;
use std::rc::Rc;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

pub async fn settle_auction_complete(
    testing_context: &TestingContext,
    payer_signer: &Rc<Keypair>,
    auction_state: &AuctionState,
    prepare_order_response_address: &Pubkey,
    prepared_custody_token: &Pubkey,
    matching_engine_program_id: &Pubkey,
    expected_error: Option<&ExpectedError>,
) -> AuctionState {
    let test_ctx = &testing_context.test_context;
    let usdc_mint_address = &testing_context.get_usdc_mint_address();
    let active_auction = auction_state
        .get_active_auction()
        .expect("Failed to get active auction");
    let base_fee_token = usdc_mint_address.clone();
    let event_seeds = EVENT_AUTHORITY_SEED;
    let event_authority =
        Pubkey::find_program_address(&[event_seeds], matching_engine_program_id).0;
    let settle_auction_accounts = SettleAuctionCompleteCpiAccounts {
        beneficiary: payer_signer.pubkey(),
        base_fee_token: base_fee_token,
        prepared_order_response: prepare_order_response_address.clone(),
        prepared_custody_token: prepared_custody_token.clone(),
        auction: active_auction.auction_address,
        best_offer_token: active_auction.best_offer.offer_token,
        token_program: spl_token::ID,
        event_authority: event_authority,
        program: *matching_engine_program_id,
    };

    let settle_auction_complete_cpi = SettleAuctionComplete {};

    let settle_auction_complete_ix = Instruction {
        program_id: *matching_engine_program_id,
        accounts: settle_auction_accounts.to_account_metas(Some(false)),
        data: settle_auction_complete_cpi.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[settle_auction_complete_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        test_ctx.borrow().last_blockhash,
    );

    testing_context
        .execute_and_verify_transaction(tx, expected_error)
        .await;
    if expected_error.is_none() {
        AuctionState::Settled
    } else {
        auction_state.clone()
    }
}
