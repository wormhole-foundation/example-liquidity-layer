use crate::testing_engine::config::ExpectedError;
use crate::utils::auction::ActiveAuctionState;
use crate::utils::setup::TestingContext;

use super::super::utils;
use anchor_spl::token::spl_token;
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use matching_engine::fallback::execute_order::{ExecuteOrderCctpShim, ExecuteOrderShimAccounts};
use solana_sdk::{
    pubkey::Pubkey, signature::Keypair, signer::Signer, sysvar::SysvarId, transaction::Transaction,
};
use std::rc::Rc;
use utils::setup::TransferDirection;
use utils::{constants::*, setup::Solver};
use wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID;
use wormhole_svm_definitions::{
    solana::{
        CORE_BRIDGE_CONFIG, CORE_BRIDGE_FEE_COLLECTOR, POST_MESSAGE_SHIM_EVENT_AUTHORITY,
        POST_MESSAGE_SHIM_PROGRAM_ID,
    },
    EVENT_AUTHORITY_SEED,
};

pub struct ExecuteOrderFallbackAccounts {
    pub signer: Pubkey,
    pub custodian: Pubkey,
    pub fast_market_order_address: Pubkey,
    pub active_auction: Pubkey,
    pub active_auction_custody_token: Pubkey,
    pub active_auction_config: Pubkey,
    pub active_auction_best_offer_token: Pubkey,
    pub initial_offer_token: Pubkey,
    pub initial_participant: Pubkey,
    pub to_router_endpoint: Pubkey,
    pub remote_token_messenger: Pubkey,
    pub token_messenger: Pubkey,
}

impl ExecuteOrderFallbackAccounts {
    pub fn new(
        auction_accounts: &utils::auction::AuctionAccounts,
        fast_market_order_address: &Pubkey,
        active_auction_state: &ActiveAuctionState,
        signer: &Pubkey,
        fixture_accounts: &utils::account_fixtures::FixtureAccounts,
        transfer_direction: TransferDirection,
    ) -> Self {
        let remote_token_messenger = match transfer_direction {
            TransferDirection::FromEthereumToArbitrum => {
                fixture_accounts.arbitrum_remote_token_messenger
            }
            TransferDirection::FromArbitrumToEthereum => {
                fixture_accounts.ethereum_remote_token_messenger
            }
            _ => panic!("Unsupported transfer direction"),
        };

        Self {
            signer: *signer,
            custodian: auction_accounts.custodian,
            fast_market_order_address: *fast_market_order_address,
            active_auction: active_auction_state.auction_address,
            active_auction_custody_token: active_auction_state.auction_custody_token_address,
            active_auction_config: auction_accounts.auction_config,
            active_auction_best_offer_token: auction_accounts.offer_token,
            initial_offer_token: auction_accounts.offer_token,
            initial_participant: *signer,
            to_router_endpoint: auction_accounts.to_router_endpoint,
            remote_token_messenger,
            token_messenger: fixture_accounts.token_messenger,
        }
    }
}

pub struct ExecuteOrderFallbackFixture {
    pub cctp_message: Pubkey,
    pub post_message_sequence: Pubkey,
    pub post_message_message: Pubkey,
    pub accounts: ExecuteOrderFallbackFixtureAccounts,
}

pub struct ExecuteOrderFallbackFixtureAccounts {
    pub local_token: Pubkey,
    pub token_messenger: Pubkey,
    pub remote_token_messenger: Pubkey,
    pub token_messenger_minter_sender_authority: Pubkey,
    pub token_messenger_minter_event_authority: Pubkey,
}

pub async fn execute_order_fallback(
    testing_context: &TestingContext,
    payer_signer: &Rc<Keypair>,
    program_id: &Pubkey,
    solver: Solver,
    execute_order_fallback_accounts: &ExecuteOrderFallbackAccounts,
    expected_error: Option<&ExpectedError>,
) -> Option<ExecuteOrderFallbackFixture> {
    // Get target chain and use as remote address
    let test_ctx = &testing_context.test_context;
    let cctp_message = Pubkey::find_program_address(
        &[
            common::CCTP_MESSAGE_SEED_PREFIX,
            &execute_order_fallback_accounts.active_auction.to_bytes(),
        ],
        program_id,
    )
    .0;
    let token_messenger_minter_sender_authority =
        Pubkey::find_program_address(&[b"sender_authority"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let messenger_transmitter_config =
        Pubkey::find_program_address(&[b"message_transmitter"], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
    let token_messenger =
        Pubkey::find_program_address(&[b"token_messenger"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let remote_token_messenger = execute_order_fallback_accounts.remote_token_messenger;
    let token_minter =
        Pubkey::find_program_address(&[b"token_minter"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let local_token = Pubkey::find_program_address(
        &[b"local_token", &USDC_MINT.to_bytes()],
        &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
    )
    .0;
    let token_messenger_minter_event_authority =
        &Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &TOKEN_MESSENGER_MINTER_PROGRAM_ID)
            .0;
    let post_message_sequence = wormhole_svm_definitions::find_emitter_sequence_address(
        &execute_order_fallback_accounts.custodian,
        &CORE_BRIDGE_PROGRAM_ID,
    )
    .0;
    let post_message_message = wormhole_svm_definitions::find_shim_message_address(
        &execute_order_fallback_accounts.custodian,
        &POST_MESSAGE_SHIM_PROGRAM_ID,
    )
    .0;
    let executor_token = solver.actor.token_account_address().unwrap();

    let execute_order_ix_accounts = ExecuteOrderShimAccounts {
        signer: &payer_signer.pubkey(),                        // 0
        cctp_message: &cctp_message,                           // 1
        custodian: &execute_order_fallback_accounts.custodian, // 2
        fast_market_order: &execute_order_fallback_accounts.fast_market_order_address, // 3
        active_auction: &execute_order_fallback_accounts.active_auction, // 4
        active_auction_custody_token: &execute_order_fallback_accounts.active_auction_custody_token, // 5
        active_auction_config: &execute_order_fallback_accounts.active_auction_config, // 6
        active_auction_best_offer_token: &execute_order_fallback_accounts
            .active_auction_best_offer_token, // 7
        executor_token: &executor_token,                                               // 8
        initial_offer_token: &execute_order_fallback_accounts.initial_offer_token,     // 9
        initial_participant: &execute_order_fallback_accounts.initial_participant,     // 10
        to_router_endpoint: &execute_order_fallback_accounts.to_router_endpoint,       // 11
        post_message_shim_program: &POST_MESSAGE_SHIM_PROGRAM_ID,                      // 12
        post_message_sequence: &post_message_sequence,                                 // 13
        post_message_message: &post_message_message,                                   // 14
        cctp_deposit_for_burn_mint: &USDC_MINT,                                        // 15
        cctp_deposit_for_burn_token_messenger_minter_sender_authority:
            &token_messenger_minter_sender_authority, // 16
        cctp_deposit_for_burn_message_transmitter_config: &messenger_transmitter_config, // 17
        cctp_deposit_for_burn_token_messenger: &token_messenger,                       // 18
        cctp_deposit_for_burn_remote_token_messenger: &remote_token_messenger,         // 19
        cctp_deposit_for_burn_token_minter: &token_minter,                             // 20
        cctp_deposit_for_burn_local_token: &local_token,                               // 21
        cctp_deposit_for_burn_token_messenger_minter_event_authority:
            token_messenger_minter_event_authority, // 22
        cctp_deposit_for_burn_token_messenger_minter_program: &TOKEN_MESSENGER_MINTER_PROGRAM_ID, // 23
        cctp_deposit_for_burn_message_transmitter_program: &MESSAGE_TRANSMITTER_PROGRAM_ID, // 24
        core_bridge_program: &CORE_BRIDGE_PROGRAM_ID,                                       // 25
        core_bridge_config: &CORE_BRIDGE_CONFIG,                                            // 26
        core_bridge_fee_collector: &CORE_BRIDGE_FEE_COLLECTOR,                              // 27
        post_message_shim_event_authority: &POST_MESSAGE_SHIM_EVENT_AUTHORITY,              // 28
        system_program: &solana_program::system_program::ID,                                // 29
        token_program: &spl_token::ID,                                                      // 30
        clock: &solana_program::clock::Clock::id(),                                         // 31
    };

    let execute_order_ix = ExecuteOrderCctpShim {
        program_id,
        accounts: execute_order_ix_accounts,
    }
    .instruction();

    // Considering fast forwarding blocks here for deadline to be reached
    let recent_blockhash = test_ctx.borrow().last_blockhash;
    utils::setup::fast_forward_slots(testing_context, 3).await;
    let transaction = Transaction::new_signed_with_payer(
        &[execute_order_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        recent_blockhash,
    );
    testing_context
        .execute_and_verify_transaction(transaction, expected_error)
        .await;
    if expected_error.is_none() {
        Some(ExecuteOrderFallbackFixture {
            cctp_message,
            post_message_sequence,
            post_message_message,
            accounts: ExecuteOrderFallbackFixtureAccounts {
                local_token,
                token_messenger,
                remote_token_messenger,
                token_messenger_minter_sender_authority,
                token_messenger_minter_event_authority: *token_messenger_minter_event_authority,
            },
        })
    } else {
        None
    }
}

pub async fn execute_order_fallback_test(
    testing_context: &TestingContext,
    auction_accounts: &utils::auction::AuctionAccounts,
    fast_market_order_address: &Pubkey,
    active_auction_state: &ActiveAuctionState,
    solver: Solver,
    expected_error: Option<&ExpectedError>,
) -> Option<ExecuteOrderFallbackFixture> {
    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Pre-made fixture accounts not found");
    let execute_order_fallback_accounts = ExecuteOrderFallbackAccounts::new(
        auction_accounts,
        fast_market_order_address,
        active_auction_state,
        &testing_context.testing_actors.owner.pubkey(),
        &fixture_accounts,
        testing_context.testing_state.transfer_direction,
    );
    execute_order_fallback(
        testing_context,
        &testing_context.testing_actors.owner.keypair(),
        &testing_context.get_matching_engine_program_id(),
        solver,
        &execute_order_fallback_accounts,
        expected_error,
    )
    .await
}
