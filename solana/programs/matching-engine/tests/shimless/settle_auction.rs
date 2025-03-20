use super::super::shimful::*;
use super::super::utils;
use anchor_lang::prelude::*;
use anchor_lang::InstructionData;
use anchor_spl::token::spl_token;
use matching_engine::accounts::SettleAuctionComplete as SettleAuctionCompleteCpiAccounts;
use matching_engine::instruction::SettleAuctionComplete;
use solana_program_test::*;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;
use std::cell::RefCell;
use std::rc::Rc;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

pub async fn settle_auction_complete(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
    usdc_mint_address: &Pubkey,
    prepare_order_response_shim_fixture: &shims_prepare_order_response::PrepareOrderResponseShimFixture,
    auction_state: &Rc<RefCell<utils::auction::ActiveAuctionState>>,
    matching_engine_program_id: &Pubkey,
) -> Result<()> {
    let base_fee_token = usdc_mint_address.clone();
    let event_seeds = EVENT_AUTHORITY_SEED;
    let event_authority =
        Pubkey::find_program_address(&[event_seeds], matching_engine_program_id).0;
    let settle_auction_accounts = SettleAuctionCompleteCpiAccounts {
        beneficiary: payer_signer.pubkey(),
        base_fee_token: base_fee_token,
        prepared_order_response: prepare_order_response_shim_fixture.prepared_order_response,
        prepared_custody_token: prepare_order_response_shim_fixture.prepared_custody_token,
        auction: auction_state.borrow().auction_address,
        best_offer_token: auction_state.borrow().best_offer.offer_token,
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

    test_ctx
        .borrow_mut()
        .banks_client
        .process_transaction(tx)
        .await
        .expect("Failed to settle auction");

    Ok(())
}
