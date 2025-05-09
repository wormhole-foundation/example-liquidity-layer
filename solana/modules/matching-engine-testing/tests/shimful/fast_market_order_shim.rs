use crate::testing_engine::config::{
    ExpectedError, InitializeFastMarketOrderShimInstructionConfig,
};
use crate::testing_engine::state::{
    FastMarketOrderAccountCreatedState, GuardianSetState, TestingEngineState,
};

use super::verify_shim::{create_guardian_signatures, GuardianSignatureInfo};
use crate::testing_engine::setup::TestingContext;
use crate::utils;
use common::messages::FastMarketOrder;
use matching_engine::fallback::close_fast_market_order::{
    CloseFastMarketOrder as CloseFastMarketOrderFallback,
    CloseFastMarketOrderAccounts as CloseFastMarketOrderFallbackAccounts,
};
use matching_engine::fallback::initialize_fast_market_order::{
    InitializeFastMarketOrder as InitializeFastMarketOrderFallback,
    InitializeFastMarketOrderAccounts as InitializeFastMarketOrderFallbackAccounts,
    InitializeFastMarketOrderData as InitializeFastMarketOrderFallbackData,
};
use utils::constants::*;

use matching_engine::state::{FastMarketOrder as FastMarketOrderState, FastMarketOrderParams};
use solana_program_test::ProgramTestContext;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, transaction::Transaction};
use std::rc::Rc;
use wormhole_io::TypePrefixedPayload;

/// Initialize the fast market order account
///
/// This function initializes the fast market order account
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The program test context
/// * `expected_error` - The expected error
/// * `current_state` - The current testing engine state
/// * `config` - The initialization configuration
///
/// # Returns
///
/// * `TestingEngineState` - The updated testing engine state
pub async fn initialize_fast_market_order_shimful(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    expected_error: Option<&ExpectedError>,
    current_state: &TestingEngineState,
    config: &InitializeFastMarketOrderShimInstructionConfig,
) -> TestingEngineState {
    let program_id = &testing_context.get_matching_engine_program_id();
    let test_vaa_pair = current_state.get_test_vaa_pair(config.vaa_index);
    let fast_transfer_vaa = test_vaa_pair.fast_transfer_vaa.clone();
    let fast_market_order = create_fast_market_order_state_from_vaa_data(
        &fast_transfer_vaa.vaa_data,
        config
            .close_account_refund_recipient
            .unwrap_or_else(|| testing_context.testing_actors.solvers[0].pubkey()),
    );
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let guardian_signature_info = create_guardian_signatures(
        &testing_context,
        test_context,
        &payer_signer,
        &fast_transfer_vaa.vaa_data,
        &testing_context.get_wormhole_program_id(),
        None,
    )
    .await
    .expect("Failed to create guardian signatures");

    let (fast_market_order_account, fast_market_order_bump) = Pubkey::find_program_address(
        &[
            FastMarketOrderState::SEED_PREFIX,
            &fast_market_order.digest(),
            &fast_market_order.close_account_refund_recipient.as_ref(),
        ],
        program_id,
    );
    let initialize_fast_market_order_ix = initialize_fast_market_order_shimful_instruction(
        &payer_signer,
        program_id,
        fast_market_order,
        &guardian_signature_info,
    );
    let transaction = testing_context
        .create_transaction(
            test_context,
            &[initialize_fast_market_order_ix],
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
        TestingEngineState::FastMarketOrderAccountCreated {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().cloned(),
            fast_market_order: FastMarketOrderAccountCreatedState {
                fast_market_order_address: fast_market_order_account,
                fast_market_order_bump,
                fast_market_order,
                close_account_refund_recipient: fast_market_order.close_account_refund_recipient,
            },
            guardian_set_state: GuardianSetState {
                guardian_set_address: guardian_signature_info.guardian_set_pubkey,
                guardian_signatures_address: guardian_signature_info.guardian_signatures_pubkey,
            },
            auction_state: current_state.auction_state().clone(),
            auction_accounts: current_state.auction_accounts().cloned(),
            order_prepared: current_state.order_prepared().cloned(),
        }
    } else {
        current_state.clone()
    }
}

/// Creates the initialize fast market order fallback instruction
///
/// This function creates the initialize fast market order fallback instruction
///
/// # Arguments
///
/// * `payer_signer` - The payer signer keypair
/// * `program_id` - The program id
/// * `fast_market_order` - The fast market order state
/// * `guardian_signature_info` - Information about guardian signatures
///
/// # Returns
///
/// * `Instruction` - The initialize fast market order fallback instruction
pub fn initialize_fast_market_order_shimful_instruction(
    payer_signer: &Rc<Keypair>,
    program_id: &Pubkey,
    fast_market_order: FastMarketOrderState,
    guardian_signature_info: &GuardianSignatureInfo,
) -> solana_program::instruction::Instruction {
    let fast_market_order_account = Pubkey::find_program_address(
        &[
            FastMarketOrderState::SEED_PREFIX,
            &fast_market_order.digest(),
            &fast_market_order.close_account_refund_recipient.as_ref(),
        ],
        program_id,
    )
    .0;

    let create_fast_market_order_accounts = InitializeFastMarketOrderFallbackAccounts {
        signer: &payer_signer.pubkey(),
        fast_market_order_account: &fast_market_order_account,
        guardian_set: &guardian_signature_info.guardian_set_pubkey,
        guardian_set_signatures: &guardian_signature_info.guardian_signatures_pubkey,
        verify_vaa_shim_program: &WORMHOLE_VERIFY_VAA_SHIM_PID,
        system_program: &solana_program::system_program::ID,
    };

    InitializeFastMarketOrderFallback {
        program_id,
        accounts: create_fast_market_order_accounts,
        data: InitializeFastMarketOrderFallbackData::new(
            fast_market_order,
            guardian_signature_info.guardian_set_bump,
        ),
    }
    .instruction()
}

/// Close the fast market order account
///
/// This function closes the fast market order account
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The program test context
/// * `refund_recipient_keypair` - The refund recipient keypair that will receive the refund
/// * `fast_market_order_address` - The fast market order account address
/// * `expected_error` - The expected error
///
/// # Asserts
///
/// * The expected error, if any, is reached when executing the instruction
pub async fn close_fast_market_order_fallback(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    refund_recipient_keypair: &Rc<Keypair>,
    fast_market_order_address: &Pubkey,
    expected_error: Option<&ExpectedError>,
) {
    let program_id = &testing_context.get_matching_engine_program_id();
    let recent_blockhash = testing_context
        .get_new_latest_blockhash(test_context)
        .await
        .expect("Failed to get new blockhash");
    let close_fast_market_order_ix = CloseFastMarketOrderFallback {
        program_id,
        accounts: CloseFastMarketOrderFallbackAccounts {
            fast_market_order: fast_market_order_address,
            close_account_refund_recipient: &refund_recipient_keypair.pubkey(),
        },
    }
    .instruction();

    let transaction = Transaction::new_signed_with_payer(
        &[close_fast_market_order_ix],
        Some(&refund_recipient_keypair.pubkey()),
        &[refund_recipient_keypair],
        recent_blockhash,
    );
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
}

/// Create the fast market order state from the vaa data
///
/// This function creates the fast market order state from the vaa data
///
/// # Arguments
///
/// * `vaa_data` - The vaa data
/// * `close_account_refund_recipient` - The close account refund recipient
///
/// # Returns
///
/// * `fast_market_order_state` - The fast market order state
pub fn create_fast_market_order_state_from_vaa_data(
    vaa_data: &utils::vaa::PostedVaaData,
    close_account_refund_recipient: Pubkey,
) -> FastMarketOrderState {
    let vaa_message = matching_engine::fallback::place_initial_offer::VaaMessageBodyHeader::new(
        vaa_data.consistency_level,
        vaa_data.vaa_time,
        vaa_data.sequence,
        vaa_data.emitter_chain,
        vaa_data.emitter_address,
    );

    let order: FastMarketOrder = TypePrefixedPayload::<1>::read_slice(&vaa_data.payload).unwrap();

    let redeemer_message_fixed_length = {
        let mut fixed_array = [0u8; 512]; // Initialize with zeros (automatic padding)

        if !order.redeemer_message.is_empty() {
            // Calculate how many bytes to copy (min of message length and array size)
            let copy_len = std::cmp::min(order.redeemer_message.len(), 512);

            // Copy the bytes from the message to the fixed array
            fixed_array[..copy_len].copy_from_slice(&order.redeemer_message[..copy_len]);
        }

        fixed_array
    };
    let fast_market_order = FastMarketOrderState::new(FastMarketOrderParams {
        amount_in: order.amount_in,
        min_amount_out: order.min_amount_out,
        deadline: order.deadline,
        target_chain: order.target_chain,
        redeemer_message_length: u16::try_from(order.redeemer_message.len()).unwrap(),
        redeemer: order.redeemer,
        sender: order.sender,
        refund_address: order.refund_address,
        max_fee: order.max_fee,
        init_auction_fee: order.init_auction_fee,
        redeemer_message: redeemer_message_fixed_length,
        close_account_refund_recipient,
        vaa_sequence: vaa_data.sequence,
        vaa_timestamp: vaa_data.vaa_time,
        vaa_nonce: vaa_data.nonce,
        vaa_emitter_chain: vaa_data.emitter_chain,
        vaa_consistency_level: vaa_data.consistency_level,
        vaa_emitter_address: vaa_data.emitter_address,
    });

    assert_eq!(fast_market_order.redeemer, order.redeemer);
    assert_eq!(
        vaa_message.digest(&fast_market_order).as_ref(),
        vaa_data.digest().as_ref()
    );

    fast_market_order
}
