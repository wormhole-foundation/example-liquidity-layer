use crate::testing_engine::config::{
    ExecuteOrderInstructionConfig, ExpectedError, InstructionConfig,
};
use crate::testing_engine::setup::{TestingContext, TransferDirection};
use crate::testing_engine::state::TestingEngineState;

use super::super::utils;
use anchor_spl::token::spl_token;
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use matching_engine::fallback::execute_order::{ExecuteOrderCctpShim, ExecuteOrderShimAccounts};
use solana_program_test::ProgramTestContext;
use solana_sdk::{pubkey::Pubkey, signer::Signer, sysvar::SysvarId, transaction::Transaction};
use utils::constants::*;
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
        current_state: &TestingEngineState,
        payer_signer: &Pubkey,
        fixture_accounts: &utils::account_fixtures::FixtureAccounts,
        override_fast_market_order_address: Option<Pubkey>,
    ) -> Self {
        let transfer_direction = current_state.base().transfer_direction;
        let auction_accounts = current_state.auction_accounts().unwrap();
        let active_auction_state = current_state.auction_state().get_active_auction().unwrap();
        let fast_market_order_address = override_fast_market_order_address.unwrap_or_else(|| {
            current_state
                .fast_market_order()
                .unwrap()
                .fast_market_order_address
        });
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
            signer: *payer_signer,
            custodian: auction_accounts.custodian,
            fast_market_order_address,
            active_auction: active_auction_state.auction_address,
            active_auction_custody_token: active_auction_state.auction_custody_token_address,
            active_auction_config: auction_accounts.auction_config,
            active_auction_best_offer_token: auction_accounts.offer_token,
            initial_offer_token: auction_accounts.offer_token,
            initial_participant: *payer_signer,
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
    pub messenger_transmitter_config: Pubkey,
    pub token_minter: Pubkey,
    pub executor_token: Pubkey,
}

pub async fn execute_order_shimful(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    config: &ExecuteOrderInstructionConfig,
    execute_order_fallback_accounts: &ExecuteOrderFallbackAccounts,
    expected_error: Option<&ExpectedError>,
) -> Option<ExecuteOrderFallbackFixture> {
    let program_id = &testing_context.get_matching_engine_program_id();
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let execute_order_fallback_fixture = create_execute_order_fallback_fixture(
        testing_context,
        config,
        execute_order_fallback_accounts,
    );
    let clock_id = solana_program::clock::Clock::id();
    let execute_order_ix_accounts = create_execute_order_shim_accounts(
        execute_order_fallback_accounts,
        &execute_order_fallback_fixture,
        &clock_id,
    );

    let execute_order_ix = ExecuteOrderCctpShim {
        program_id,
        accounts: execute_order_ix_accounts,
    }
    .instruction();

    // Considering fast forwarding blocks here for deadline to be reached
    let recent_blockhash = testing_context
        .get_new_latest_blockhash(test_context)
        .await
        .unwrap();
    let slots_to_fast_forward = config.fast_forward_slots;
    if slots_to_fast_forward > 0 {
        crate::testing_engine::engine::fast_forward_slots(test_context, slots_to_fast_forward)
            .await;
    }
    let transaction = Transaction::new_signed_with_payer(
        &[execute_order_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        recent_blockhash,
    );
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
    if expected_error.is_none() {
        Some(execute_order_fallback_fixture)
    } else {
        None
    }
}

pub fn create_execute_order_fallback_fixture(
    testing_context: &TestingContext,
    config: &ExecuteOrderInstructionConfig,
    execute_order_fallback_accounts: &ExecuteOrderFallbackAccounts,
) -> ExecuteOrderFallbackFixture {
    let program_id = &testing_context.get_matching_engine_program_id();
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
    let solver = config.actor_enum.get_actor(&testing_context.testing_actors);
    let executor_token = solver.token_account_address(&config.token_enum).unwrap();
    ExecuteOrderFallbackFixture {
        cctp_message,
        post_message_sequence,
        post_message_message,
        accounts: ExecuteOrderFallbackFixtureAccounts {
            local_token,
            token_messenger,
            remote_token_messenger,
            token_messenger_minter_sender_authority,
            token_messenger_minter_event_authority: *token_messenger_minter_event_authority,
            messenger_transmitter_config,
            token_minter,
            executor_token,
        },
    }
}

/// Create the execute order shim accounts
///
/// # Arguments
///
/// * `execute_order_fallback_accounts` - The execute order fallback accounts
/// * `execute_order_fallback_fixture` - The execute order fallback fixture
/// * `clock_id` - The clock id
///
/// # Returns
///
/// The execute order shim accounts
pub fn create_execute_order_shim_accounts<'ix>(
    execute_order_fallback_accounts: &'ix ExecuteOrderFallbackAccounts,
    execute_order_fallback_fixture: &'ix ExecuteOrderFallbackFixture,
    clock_id: &'ix Pubkey,
) -> ExecuteOrderShimAccounts<'ix> {
    ExecuteOrderShimAccounts {
        signer: &execute_order_fallback_accounts.signer, // 0
        cctp_message: &execute_order_fallback_fixture.cctp_message, // 1
        custodian: &execute_order_fallback_accounts.custodian, // 2
        fast_market_order: &execute_order_fallback_accounts.fast_market_order_address, // 3
        active_auction: &execute_order_fallback_accounts.active_auction, // 4
        active_auction_custody_token: &execute_order_fallback_accounts.active_auction_custody_token, // 5
        active_auction_config: &execute_order_fallback_accounts.active_auction_config, // 6
        active_auction_best_offer_token: &execute_order_fallback_accounts
            .active_auction_best_offer_token, // 7
        executor_token: &execute_order_fallback_fixture.accounts.executor_token,       // 8
        initial_offer_token: &execute_order_fallback_accounts.initial_offer_token,     // 9
        initial_participant: &execute_order_fallback_accounts.initial_participant,     // 10
        to_router_endpoint: &execute_order_fallback_accounts.to_router_endpoint,       // 11
        post_message_shim_program: &POST_MESSAGE_SHIM_PROGRAM_ID,                      // 12
        core_bridge_emitter_sequence: &execute_order_fallback_fixture.post_message_sequence, // 13
        post_shim_message: &execute_order_fallback_fixture.post_message_message,       // 14
        cctp_deposit_for_burn_mint: &USDC_MINT,                                        // 15
        cctp_deposit_for_burn_token_messenger_minter_sender_authority:
            &execute_order_fallback_fixture
                .accounts
                .token_messenger_minter_sender_authority, // 16
        cctp_deposit_for_burn_message_transmitter_config: &execute_order_fallback_fixture
            .accounts
            .messenger_transmitter_config, // 17
        cctp_deposit_for_burn_token_messenger: &execute_order_fallback_fixture
            .accounts
            .token_messenger, // 18
        cctp_deposit_for_burn_remote_token_messenger: &execute_order_fallback_fixture
            .accounts
            .remote_token_messenger, // 19
        cctp_deposit_for_burn_token_minter: &execute_order_fallback_fixture.accounts.token_minter, // 20
        cctp_deposit_for_burn_local_token: &execute_order_fallback_fixture.accounts.local_token, // 21
        cctp_deposit_for_burn_token_messenger_minter_event_authority:
            &execute_order_fallback_fixture
                .accounts
                .token_messenger_minter_event_authority, // 22
        cctp_deposit_for_burn_token_messenger_minter_program: &TOKEN_MESSENGER_MINTER_PROGRAM_ID, // 23
        cctp_deposit_for_burn_message_transmitter_program: &MESSAGE_TRANSMITTER_PROGRAM_ID, // 24
        core_bridge_program: &CORE_BRIDGE_PROGRAM_ID,                                       // 25
        core_bridge_config: &CORE_BRIDGE_CONFIG,                                            // 26
        core_bridge_fee_collector: &CORE_BRIDGE_FEE_COLLECTOR,                              // 27
        post_message_shim_event_authority: &POST_MESSAGE_SHIM_EVENT_AUTHORITY,              // 28
        system_program: &solana_program::system_program::ID,                                // 29
        token_program: &spl_token::ID,                                                      // 30
        clock: clock_id,                                                                    // 31
    }
}

pub async fn execute_order_shimful_test(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &ExecuteOrderInstructionConfig,
) -> Option<ExecuteOrderFallbackFixture> {
    let expected_error = config.expected_error();
    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Pre-made fixture accounts not found");
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let execute_order_fallback_accounts = ExecuteOrderFallbackAccounts::new(
        current_state,
        &payer_signer.pubkey(),
        &fixture_accounts,
        config.fast_market_order_address,
    );
    execute_order_shimful(
        testing_context,
        test_context,
        config,
        &execute_order_fallback_accounts,
        expected_error,
    )
    .await
}
