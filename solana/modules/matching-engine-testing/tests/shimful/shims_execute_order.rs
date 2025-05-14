use crate::testing_engine::config::{ExecuteOrderInstructionConfig, InstructionConfig};
use crate::testing_engine::setup::{TestingContext, TransferDirection};
use crate::testing_engine::state::{OrderExecutedState, TestingEngineState};

use super::super::utils;
use anchor_spl::token::spl_token;
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use matching_engine::accounts::CctpDepositForBurn;
use matching_engine::fallback::execute_order::{ExecuteOrderCctpShim, ExecuteOrderShimAccounts};
use solana_program_test::ProgramTestContext;
use solana_sdk::{pubkey::Pubkey, signer::Signer, sysvar::SysvarId};
use utils::constants::*;
use wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID;
use wormhole_svm_definitions::{
    solana::{
        CORE_BRIDGE_CONFIG, CORE_BRIDGE_FEE_COLLECTOR, POST_MESSAGE_SHIM_EVENT_AUTHORITY,
        POST_MESSAGE_SHIM_PROGRAM_ID,
    },
    EVENT_AUTHORITY_SEED,
};

/// Execute an order using the shim
///
/// # Arguments
///
/// * `testing_context` - The testing context of the testing engine
/// * `test_context` - Mutable reference to the test context
/// * `current_state` - The current state of the testing engine
/// * `config` - The execute order instruction config
///
/// # Returns
///
/// The new state of the testing engine
pub async fn execute_order_shimful(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &ExecuteOrderInstructionConfig,
) -> TestingEngineState {
    let expected_error = config.expected_error();
    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Pre-made fixture accounts not found");

    let execute_order_fallback_accounts = ExecuteOrderShimfulAccounts::new(
        testing_context,
        current_state,
        config,
        &fixture_accounts,
        config.fast_market_order_address,
    );
    let program_id = &testing_context.get_matching_engine_program_id();
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let clock_id = solana_program::clock::Clock::id();
    let execute_order_ix_accounts =
        create_execute_order_shim_accounts(&execute_order_fallback_accounts, &clock_id);

    let execute_order_ix = ExecuteOrderCctpShim {
        program_id,
        accounts: execute_order_ix_accounts,
    }
    .instruction();

    let slots_to_fast_forward = config.fast_forward_slots;
    if slots_to_fast_forward > 0 {
        crate::testing_engine::engine::fast_forward_slots(test_context, slots_to_fast_forward)
            .await;
    }
    let transaction = testing_context
        .create_transaction(
            test_context,
            &[execute_order_ix],
            Some(&payer_signer.pubkey()),
            &[&payer_signer],
            None,
            None,
        )
        .await;
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
    if config.expected_error.is_none() {
        let auction_accounts = current_state
            .auction_accounts()
            .expect("Auction accounts not found");
        let order_executed_state =
            create_order_executed_state(config, &execute_order_fallback_accounts);
        TestingEngineState::OrderExecuted {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().unwrap().clone(),
            fast_market_order: current_state.fast_market_order().cloned(),
            auction_state: current_state.auction_state().clone(),
            order_executed: order_executed_state,
            auction_accounts: auction_accounts.clone(),
            order_prepared: current_state.order_prepared().cloned(),
        }
    } else {
        current_state.clone()
    }
}

/// A helper struct for the accounts for the execute order shimful instruction that disregards the lifetime
struct ExecuteOrderShimfulAccounts {
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
    pub local_token: Pubkey,
    pub token_messenger_minter_sender_authority: Pubkey,
    pub token_messenger_minter_event_authority: Pubkey,
    pub messenger_transmitter_config: Pubkey,
    pub token_minter: Pubkey,
    pub executor_token: Pubkey,
    pub cctp_message: Pubkey,
    pub post_message_sequence: Pubkey,
    pub post_message_message: Pubkey,
}

impl ExecuteOrderShimfulAccounts {
    pub fn new(
        testing_context: &TestingContext,
        current_state: &TestingEngineState,
        config: &ExecuteOrderInstructionConfig,
        fixture_accounts: &utils::account_fixtures::FixtureAccounts,
        override_fast_market_order_address: Option<Pubkey>,
    ) -> Self {
        let payer_signer = config
            .payer_signer
            .clone()
            .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
        let transfer_direction = current_state.base().transfer_direction;
        let auction_accounts = current_state.auction_accounts().unwrap();
        let active_auction_state = current_state.auction_state().get_active_auction().unwrap();
        let initial_participant = active_auction_state.initial_offer.participant;
        let active_auction = active_auction_state.auction_address;
        let custodian = auction_accounts.custodian;
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
        let program_id = &testing_context.get_matching_engine_program_id();
        let cctp_message = Pubkey::find_program_address(
            &[common::CCTP_MESSAGE_SEED_PREFIX, &active_auction.to_bytes()],
            program_id,
        )
        .0;
        let token_messenger_minter_sender_authority = Pubkey::find_program_address(
            &[b"sender_authority"],
            &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        )
        .0;
        let messenger_transmitter_config = Pubkey::find_program_address(
            &[b"message_transmitter"],
            &MESSAGE_TRANSMITTER_PROGRAM_ID,
        )
        .0;
        let token_messenger =
            Pubkey::find_program_address(&[b"token_messenger"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID)
                .0;
        assert_eq!(token_messenger, fixture_accounts.token_messenger);
        let token_minter =
            Pubkey::find_program_address(&[b"token_minter"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
        let local_token = Pubkey::find_program_address(
            &[b"local_token", &USDC_MINT.to_bytes()],
            &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        )
        .0;
        let token_messenger_minter_event_authority = Pubkey::find_program_address(
            &[EVENT_AUTHORITY_SEED],
            &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        )
        .0;
        let post_message_sequence = wormhole_svm_definitions::find_emitter_sequence_address(
            &custodian,
            &CORE_BRIDGE_PROGRAM_ID,
        )
        .0;
        let post_message_message = wormhole_svm_definitions::find_shim_message_address(
            &custodian,
            &POST_MESSAGE_SHIM_PROGRAM_ID,
        )
        .0;
        let solver = config.actor_enum.get_actor(&testing_context.testing_actors);
        let executor_token = solver.token_account_address(&config.token_enum).unwrap();

        Self {
            signer: payer_signer.pubkey(),
            custodian: auction_accounts.custodian,
            fast_market_order_address,
            active_auction: active_auction_state.auction_address,
            active_auction_custody_token: active_auction_state.auction_custody_token_address,
            active_auction_config: auction_accounts.auction_config,
            active_auction_best_offer_token: auction_accounts.offer_token,
            initial_offer_token: auction_accounts.offer_token,
            initial_participant,
            to_router_endpoint: auction_accounts.to_router_endpoint,
            remote_token_messenger,
            token_messenger,
            local_token,
            token_messenger_minter_sender_authority,
            token_messenger_minter_event_authority,
            messenger_transmitter_config,
            token_minter,
            executor_token,
            cctp_message,
            post_message_sequence,
            post_message_message,
        }
    }
}

fn create_order_executed_state(
    config: &ExecuteOrderInstructionConfig,
    execute_order_fallback_accounts: &ExecuteOrderShimfulAccounts,
) -> OrderExecutedState {
    OrderExecutedState {
        cctp_message: execute_order_fallback_accounts.cctp_message,
        post_message_sequence: Some(execute_order_fallback_accounts.post_message_sequence),
        post_message_message: Some(execute_order_fallback_accounts.post_message_message),
        actor_enum: config.actor_enum,
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
fn create_execute_order_shim_accounts<'ix>(
    execute_order_fallback_accounts: &'ix ExecuteOrderShimfulAccounts,
    clock_id: &'ix Pubkey,
) -> ExecuteOrderShimAccounts<'ix> {
    ExecuteOrderShimAccounts {
        signer: &execute_order_fallback_accounts.signer, // 0
        cctp_message: &execute_order_fallback_accounts.cctp_message, // 1
        custodian: &execute_order_fallback_accounts.custodian, // 2
        fast_market_order: &execute_order_fallback_accounts.fast_market_order_address, // 3
        active_auction: &execute_order_fallback_accounts.active_auction, // 4
        active_auction_custody_token: &execute_order_fallback_accounts.active_auction_custody_token, // 5
        active_auction_config: &execute_order_fallback_accounts.active_auction_config, // 6
        active_auction_best_offer_token: &execute_order_fallback_accounts
            .active_auction_best_offer_token, // 7
        executor_token: &execute_order_fallback_accounts.executor_token,               // 8
        initial_offer_token: &execute_order_fallback_accounts.initial_offer_token,     // 9
        initial_participant: &execute_order_fallback_accounts.initial_participant,     // 10
        to_router_endpoint: &execute_order_fallback_accounts.to_router_endpoint,       // 11
        post_message_shim_program: &POST_MESSAGE_SHIM_PROGRAM_ID,                      // 12
        core_bridge_emitter_sequence: &execute_order_fallback_accounts.post_message_sequence, // 13
        post_shim_message: &execute_order_fallback_accounts.post_message_message,      // 14
        cctp_deposit_for_burn_mint: &USDC_MINT,                                        // 15
        cctp_deposit_for_burn_token_messenger_minter_sender_authority:
            &execute_order_fallback_accounts.token_messenger_minter_sender_authority, // 16
        cctp_deposit_for_burn_message_transmitter_config: &execute_order_fallback_accounts
            .messenger_transmitter_config, // 17
        cctp_deposit_for_burn_token_messenger: &execute_order_fallback_accounts.token_messenger, // 18
        cctp_deposit_for_burn_remote_token_messenger: &execute_order_fallback_accounts
            .remote_token_messenger, // 19
        cctp_deposit_for_burn_token_minter: &execute_order_fallback_accounts.token_minter, // 20
        cctp_deposit_for_burn_local_token: &execute_order_fallback_accounts.local_token,   // 21
        cctp_deposit_for_burn_token_messenger_minter_event_authority:
            &execute_order_fallback_accounts.token_messenger_minter_event_authority, // 22
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

pub struct CctpAccounts {
    pub mint: Pubkey,
    pub token_messenger: Pubkey,
    pub token_messenger_minter_sender_authority: Pubkey,
    pub token_messenger_minter_event_authority: Pubkey,
    pub message_transmitter_config: Pubkey,
    pub token_minter: Pubkey,
    pub local_token: Pubkey,
    pub remote_token_messenger: Pubkey,
    pub token_messenger_minter_program: Pubkey,
    pub message_transmitter_program: Pubkey,
}

impl Into<CctpDepositForBurn> for CctpAccounts {
    fn into(self) -> CctpDepositForBurn {
        CctpDepositForBurn {
            mint: self.mint,
            local_token: self.local_token,
            token_messenger_minter_sender_authority: self.token_messenger_minter_sender_authority,
            message_transmitter_config: self.message_transmitter_config,
            token_messenger: self.token_messenger,
            remote_token_messenger: self.remote_token_messenger,
            token_minter: self.token_minter,
            token_messenger_minter_event_authority: self.token_messenger_minter_event_authority,
            message_transmitter_program: self.message_transmitter_program,
            token_messenger_minter_program: self.token_messenger_minter_program,
        }
    }
}

pub fn create_cctp_accounts(
    current_state: &TestingEngineState,
    testing_context: &TestingContext,
) -> CctpAccounts {
    let transfer_direction = current_state.base().transfer_direction;
    let fixture_accounts = testing_context.get_fixture_accounts().unwrap();
    let remote_token_messenger = match transfer_direction {
        TransferDirection::FromEthereumToArbitrum => {
            fixture_accounts.arbitrum_remote_token_messenger
        }
        TransferDirection::FromArbitrumToEthereum => {
            fixture_accounts.ethereum_remote_token_messenger
        }
        _ => panic!("Unsupported transfer direction"),
    };
    let token_messenger_minter_sender_authority =
        Pubkey::find_program_address(&[b"sender_authority"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let message_transmitter_config =
        Pubkey::find_program_address(&[b"message_transmitter"], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
    let token_messenger =
        Pubkey::find_program_address(&[b"token_messenger"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let token_minter =
        Pubkey::find_program_address(&[b"token_minter"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let local_token = Pubkey::find_program_address(
        &[b"local_token", &USDC_MINT.to_bytes()],
        &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
    )
    .0;
    let token_messenger_minter_event_authority =
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    CctpAccounts {
        mint: utils::constants::USDC_MINT,
        token_messenger,
        token_messenger_minter_sender_authority,
        token_messenger_minter_event_authority,
        message_transmitter_config,
        token_minter,
        local_token,
        remote_token_messenger,
        token_messenger_minter_program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        message_transmitter_program: MESSAGE_TRANSMITTER_PROGRAM_ID,
    }
}

pub fn create_cctp_deposit_for_burn(
    current_state: &TestingEngineState,
    testing_context: &TestingContext,
) -> CctpDepositForBurn {
    let cctp_accounts = create_cctp_accounts(current_state, testing_context);
    cctp_accounts.into()
}
