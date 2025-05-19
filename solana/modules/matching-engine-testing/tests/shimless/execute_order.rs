use std::rc::Rc;

use crate::testing_engine::config::{ExecuteOrderInstructionConfig, InstructionConfig};
use crate::testing_engine::setup::{TestingContext, TransferDirection};
use crate::testing_engine::state::{OrderExecutedState, TestingEngineState};
use crate::utils::auction::{AuctionAccounts, AuctionState};
use anchor_lang::prelude::*;
use anchor_lang::{InstructionData, ToAccountMetas};
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use matching_engine::accounts::{CctpDepositForBurn, WormholePublishMessage};
use matching_engine::accounts::{
    ExecuteFastOrderCctp as ExecuteOrderShimlessAccounts, LiquidityLayerVaa, LiveRouterEndpoint,
    RequiredSysvars,
};
use matching_engine::instruction::ExecuteFastOrderCctp as ExecuteOrderShimlessInstruction;
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::sysvar::SysvarId;
use solana_sdk::transaction::Transaction;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

/// Execute order shimless
///
/// Helper function to execute an order using the shimless method
///
/// # Arguments
///
/// * `testing_context`: The testing context of the testing engine
/// * `test_context`: A mutable reference to the test context
/// * `current_state`: The current state of the testing engine
/// * `config`: The execute order instruction config
/// * `auction_accounts`: The auction accounts
///
/// # Returns
///
/// The new state of the testing engine
pub async fn execute_order_shimless(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &ExecuteOrderInstructionConfig,
    auction_accounts: &AuctionAccounts,
) -> TestingEngineState {
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let auction_state = current_state.auction_state();
    let slots_to_fast_forward = config.fast_forward_slots;
    if slots_to_fast_forward > 0 {
        crate::testing_engine::engine::fast_forward_slots(test_context, slots_to_fast_forward)
            .await;
    }
    let execute_order_accounts: ExecuteOrderShimlessAccounts =
        create_execute_order_shimless_accounts(
            testing_context,
            auction_accounts,
            &payer_signer,
            auction_state,
            config,
        );
    let execute_order_instruction_data = ExecuteOrderShimlessInstruction {}.data();
    let execute_order_ix = Instruction {
        program_id: testing_context.get_matching_engine_program_id(),
        accounts: execute_order_accounts.to_account_metas(None),
        data: execute_order_instruction_data,
    };
    let tx = Transaction::new_signed_with_payer(
        &[execute_order_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        testing_context
            .get_new_latest_blockhash(test_context)
            .await
            .unwrap(),
    );
    let expected_error = config.expected_error();
    testing_context
        .execute_and_verify_transaction(test_context, tx, expected_error)
        .await;
    if config.expected_error.is_none() {
        let order_executed_state = OrderExecutedState {
            cctp_message: execute_order_accounts.cctp_message,
            post_message_sequence: None,
            post_message_message: None,
            actor_enum: config.actor_enum,
        };
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

/// Create execute order shimless accounts
///
/// Helper function to create the accounts needed for the execute order instruction
///
/// # Arguments
///
/// * `testing_context`: The testing context
/// * `auction_accounts`: The auction accounts
/// * `payer_signer`: The payer signer
/// * `auction_state`: The auction state
/// * `config`: The execute order instruction config
///
/// # Returns
///
/// The execute order shimless accounts
fn create_execute_order_shimless_accounts(
    testing_context: &TestingContext,
    auction_accounts: &AuctionAccounts,
    payer_signer: &Rc<Keypair>,
    auction_state: &AuctionState,
    config: &ExecuteOrderInstructionConfig,
) -> ExecuteOrderShimlessAccounts {
    let fixture_accounts = testing_context
        .get_fixture_accounts()
        .expect("Fixture accounts not found");
    let executor_token = config
        .actor_enum
        .get_actor(&testing_context.testing_actors)
        .token_account_address(&config.token_enum)
        .unwrap_or_else(|| {
            auction_state
                .get_active_auction()
                .unwrap()
                .best_offer
                .offer_token
        });
    let active_auction_state = auction_state.get_active_auction().unwrap();
    let active_auction_address = active_auction_state.auction_address;
    let active_auction_custody_token = active_auction_state.auction_custody_token_address;
    let cctp_message = Pubkey::find_program_address(
        &[
            common::CCTP_MESSAGE_SEED_PREFIX,
            &active_auction_address.to_bytes(),
        ],
        &testing_context.get_matching_engine_program_id(),
    )
    .0;
    let to_router_endpoint = LiveRouterEndpoint {
        endpoint: auction_accounts.to_router_endpoint,
    };
    // TODO: FIGURE out how to get this
    let emitter_sequence = wormhole_svm_definitions::find_emitter_sequence_address(
        &auction_accounts.custodian,
        &wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID,
    )
    .0;
    let checked_custodian = matching_engine::accounts::CheckedCustodian {
        custodian: auction_accounts.custodian,
    };
    let wormhole_publish_message = WormholePublishMessage {
        config: wormhole_svm_definitions::solana::CORE_BRIDGE_CONFIG,
        emitter_sequence,
        fee_collector: wormhole_svm_definitions::solana::CORE_BRIDGE_FEE_COLLECTOR,
        core_bridge_program: wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID,
    };
    let fast_vaa = LiquidityLayerVaa {
        vaa: auction_accounts.posted_fast_vaa.unwrap(),
    };
    let active_auction = matching_engine::accounts::ActiveAuction {
        auction: active_auction_address,
        custody_token: active_auction_custody_token,
        config: auction_accounts.auction_config,
        best_offer_token: active_auction_state.best_offer.offer_token,
    };
    let execute_order = matching_engine::accounts::ExecuteOrder {
        fast_vaa,
        active_auction,
        executor_token,
        initial_participant: active_auction_state.initial_offer.participant,
        initial_offer_token: active_auction_state.initial_offer.offer_token,
    };
    let core_message = Pubkey::find_program_address(
        &[
            common::CORE_MESSAGE_SEED_PREFIX,
            &active_auction_address.to_bytes(),
        ],
        &testing_context.get_matching_engine_program_id(),
    )
    .0;
    let sysvars = RequiredSysvars {
        clock: Clock::id(),
        rent: Rent::id(),
    };
    let token_messenger_minter_event_authority =
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let local_token = Pubkey::find_program_address(
        &[
            b"local_token",
            &testing_context.get_usdc_mint_address().to_bytes(),
        ],
        &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
    )
    .0;
    let token_messenger_minter_sender_authority =
        Pubkey::find_program_address(&[b"sender_authority"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let message_transmitter_config =
        Pubkey::find_program_address(&[b"message_transmitter"], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
    let token_messenger =
        Pubkey::find_program_address(&[b"token_messenger"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let remote_token_messenger = match testing_context.transfer_direction {
        TransferDirection::FromEthereumToArbitrum => {
            fixture_accounts.arbitrum_remote_token_messenger
        }
        TransferDirection::FromArbitrumToEthereum => {
            fixture_accounts.ethereum_remote_token_messenger
        }
        _ => panic!("Unsupported transfer direction"),
    };
    let token_minter =
        Pubkey::find_program_address(&[b"token_minter"], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;
    let cctp = CctpDepositForBurn {
        mint: testing_context.get_usdc_mint_address(),
        local_token,
        token_messenger_minter_sender_authority,
        message_transmitter_config,
        token_messenger,
        remote_token_messenger,
        token_minter,
        token_messenger_minter_event_authority,
        message_transmitter_program: MESSAGE_TRANSMITTER_PROGRAM_ID,
        token_messenger_minter_program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
    };

    let event_authority = Pubkey::find_program_address(
        &[EVENT_AUTHORITY_SEED],
        &testing_context.get_matching_engine_program_id(),
    )
    .0;
    ExecuteOrderShimlessAccounts {
        payer: payer_signer.pubkey(),
        core_message,
        cctp_message,
        to_router_endpoint,
        custodian: checked_custodian,
        execute_order,
        wormhole: wormhole_publish_message,
        cctp,
        system_program: solana_program::system_program::ID,
        token_program: anchor_spl::token::spl_token::ID,
        event_authority,
        program: testing_context.get_matching_engine_program_id(),
        sysvars,
    }
}
