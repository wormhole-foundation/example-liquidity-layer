use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use common::wormhole_cctp_solana::cctp::{MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID};
use wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID;
use super::{constants::*, setup::Solver};
use solana_sdk::{
    pubkey::Pubkey, signature::Keypair, signer::Signer, sysvar::SysvarId, transaction::Transaction
};
use solana_program_test::ProgramTestContext;
use std::rc::Rc;
use std::cell::RefCell;
use wormhole_svm_definitions::{
    solana::POST_MESSAGE_SHIM_PROGRAM_ID, EVENT_AUTHORITY_SEED
};
use matching_engine::fallback::execute_order::{ExecuteOrderShimAccounts, ExecuteOrderCctpShimData, ExecuteOrderCctpShim};
use matching_engine::state::FastMarketOrder as FastMarketOrderState;

use super::constants::{CORE_BRIDGE_CONFIG, CORE_BRIDGE_PID, CORE_BRIDGE_FEE_COLLECTOR};

pub struct ExecuteOrderFallbackAccounts {
    pub custodian: Pubkey,
    pub fast_market_order_address: Pubkey,
    pub active_auction: Pubkey,
    pub active_auction_custody_token: Pubkey,
    pub active_auction_config: Pubkey,
    pub active_auction_best_offer_token: Pubkey,
    pub initial_offer_token: Pubkey,
    pub initial_participant: Pubkey,
    pub to_router_endpoint: Pubkey,
}

impl ExecuteOrderFallbackAccounts {
    pub fn new(auction_accounts: &super::auction::AuctionAccounts, place_initial_offer_fixture: &super::shims::PlaceInitialOfferShimFixture ) -> Self {
        Self {
            custodian: auction_accounts.custodian,
            fast_market_order_address: place_initial_offer_fixture.fast_market_order_address,
            active_auction: place_initial_offer_fixture.auction_address,
            active_auction_custody_token: place_initial_offer_fixture.auction_custody_token_address,
            active_auction_config: auction_accounts.auction_config,
            active_auction_best_offer_token: auction_accounts.offer_token,
            initial_offer_token: auction_accounts.offer_token,
            initial_participant: auction_accounts.solver.actor.pubkey(),
            to_router_endpoint: auction_accounts.to_router_endpoint,
        }
    }
}

pub async fn execute_order_fallback(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>, program_id: &Pubkey, solver: Solver, execute_order_fallback_accounts: &ExecuteOrderFallbackAccounts, fast_market_order: FastMarketOrderState) -> Result<()> {

    // Get target chain and use as remote address
    let target_chain = fast_market_order.target_chain;

    let cctp_message = Pubkey::find_program_address(&[b"cctp-msg", &execute_order_fallback_accounts.active_auction.to_bytes()], program_id).0;
    let token_messenger_minter_sender_authority = Pubkey::find_program_address(&[b"sender_authority"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let messenger_transmitter_config = Pubkey::find_program_address(&[b"message_transmitter"], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
    let token_messenger = Pubkey::find_program_address(&[b"token_messenger"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let remote_token_messenger = Pubkey::find_program_address(&[b"remote_token_messenger", &target_chain.to_string().as_bytes()], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let token_minter = Pubkey::find_program_address(&[b"token_minter"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let local_token = Pubkey::find_program_address(&[b"local_token", &USDC_MINT.to_bytes()], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let token_messenger_minter_event_authority = &Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let post_message_sequence = wormhole_svm_definitions::find_emitter_sequence_address(&execute_order_fallback_accounts.custodian, &CORE_BRIDGE_PROGRAM_ID).0;
    let post_message_message = wormhole_svm_definitions::find_shim_message_address(&execute_order_fallback_accounts.custodian, &POST_MESSAGE_SHIM_PROGRAM_ID).0;
    let executor_token = solver.actor.token_account_address().unwrap();
    let execute_order_ix_accounts = ExecuteOrderShimAccounts {
        signer: &payer_signer.pubkey(),
        cctp_message: &cctp_message,
        custodian: &execute_order_fallback_accounts.custodian,
        fast_market_order: &execute_order_fallback_accounts.fast_market_order_address,
        active_auction: &execute_order_fallback_accounts.active_auction,
        active_auction_custody_token: &execute_order_fallback_accounts.active_auction_custody_token,
        active_auction_config: &execute_order_fallback_accounts.active_auction_config,
        active_auction_best_offer_token: &execute_order_fallback_accounts.active_auction_best_offer_token,
        executor_token: &executor_token,
        initial_offer_token: &execute_order_fallback_accounts.initial_offer_token,
        initial_participant: &execute_order_fallback_accounts.initial_participant,
        to_router_endpoint: &execute_order_fallback_accounts.to_router_endpoint,
        post_message_shim_program: &POST_MESSAGE_SHIM_PROGRAM_ID,
        post_message_sequence: &post_message_sequence,
        post_message_message: &post_message_message,
        cctp_deposit_for_burn_mint: &USDC_MINT,
        cctp_deposit_for_burn_token_messenger_minter_sender_authority: &token_messenger_minter_sender_authority,
        cctp_deposit_for_burn_message_transmitter_config: &messenger_transmitter_config,
        cctp_deposit_for_burn_token_messenger: &token_messenger,
        cctp_deposit_for_burn_remote_token_messenger: &remote_token_messenger,
        cctp_deposit_for_burn_token_minter: &token_minter,
        cctp_deposit_for_burn_local_token: &local_token,
        cctp_deposit_for_burn_token_messenger_minter_event_authority: &token_messenger_minter_event_authority,
        cctp_deposit_for_burn_token_messenger_minter_program: &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        cctp_deposit_for_burn_message_transmitter_program: &MESSAGE_TRANSMITTER_PROGRAM_ID,
        system_program: &solana_program::system_program::ID,
        token_program: &spl_token::ID,
        clock: &solana_program::clock::Clock::id(),
        rent: &solana_program::rent::Rent::id(),
    };

    let execute_order_ix_data = ExecuteOrderCctpShimData::new(
        target_chain as u32,
    );

    let execute_order_ix = ExecuteOrderCctpShim {
        program_id: program_id,
        accounts: execute_order_ix_accounts,
        data: execute_order_ix_data,
    }.instruction();

    // Considering fast forwarding blocks here for deadline to be reached
    let recent_blockhash = test_ctx.borrow().last_blockhash;
    let transaction = Transaction::new_signed_with_payer(&[execute_order_ix], Some(&payer_signer.pubkey()), &[&payer_signer], recent_blockhash);
    test_ctx.borrow_mut().banks_client.process_transaction(transaction).await.expect("Failed to execute order");

    Ok(())
}