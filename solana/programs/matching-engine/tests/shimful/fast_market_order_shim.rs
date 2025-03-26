use crate::testing_engine::config::ExpectedError;

use super::super::utils;
use super::super::utils::constants::*;
use super::super::utils::setup::TestingContext;
use common::messages::FastMarketOrder;
use matching_engine::fallback::close_fast_market_order::{
    CloseFastMarketOrder as CloseFastMarketOrderFallback,
    CloseFastMarketOrderAccounts as CloseFastMarketOrderFallbackAccounts,
};
use matching_engine::fallback::initialise_fast_market_order::{
    InitialiseFastMarketOrder as InitialiseFastMarketOrderFallback,
    InitialiseFastMarketOrderAccounts as InitialiseFastMarketOrderFallbackAccounts,
    InitialiseFastMarketOrderData as InitialiseFastMarketOrderFallbackData,
};

use matching_engine::state::FastMarketOrder as FastMarketOrderState;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, transaction::Transaction};
use std::rc::Rc;
use wormhole_io::TypePrefixedPayload;

pub fn initialise_fast_market_order_fallback_instruction(
    payer_signer: &Rc<Keypair>,
    program_id: &Pubkey,
    fast_market_order: FastMarketOrderState,
    guardian_set_pubkey: Pubkey,
    guardian_signatures_pubkey: Pubkey,
    guardian_set_bump: u8,
) -> solana_program::instruction::Instruction {
    let fast_market_order_account = Pubkey::find_program_address(
        &[
            FastMarketOrderState::SEED_PREFIX,
            &fast_market_order.digest(),
            &fast_market_order.close_account_refund_recipient,
        ],
        program_id,
    )
    .0;

    let create_fast_market_order_accounts = InitialiseFastMarketOrderFallbackAccounts {
        signer: &payer_signer.pubkey(),
        fast_market_order_account: &fast_market_order_account,
        guardian_set: &guardian_set_pubkey,
        guardian_set_signatures: &guardian_signatures_pubkey,
        verify_vaa_shim_program: &WORMHOLE_VERIFY_VAA_SHIM_PID,
        system_program: &solana_program::system_program::ID,
    };

    InitialiseFastMarketOrderFallback {
        program_id: program_id,
        accounts: create_fast_market_order_accounts,
        data: InitialiseFastMarketOrderFallbackData::new(fast_market_order, guardian_set_bump),
    }
    .instruction()
}

pub async fn close_fast_market_order_fallback(
    testing_context: &TestingContext,
    refund_recipient_keypair: &Rc<Keypair>,
    program_id: &Pubkey,
    fast_market_order_address: &Pubkey,
    expected_error: Option<&ExpectedError>,
) {
    let test_ctx = &testing_context.test_context;
    let recent_blockhash = test_ctx
        .borrow_mut()
        .get_new_latest_blockhash()
        .await
        .expect("Failed to get new blockhash");
    let close_fast_market_order_ix = CloseFastMarketOrderFallback {
        program_id: program_id,
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
        .execute_and_verify_transaction(transaction, expected_error)
        .await;
}

pub fn create_fast_market_order_state_from_vaa_data(
    vaa_data: &utils::vaa::PostedVaaData,
    close_account_refund_recipient: Pubkey,
) -> (FastMarketOrderState, utils::vaa::PostedVaaData) {
    let vaa_data = utils::vaa::PostedVaaData {
        consistency_level: vaa_data.consistency_level,
        vaa_time: vaa_data.vaa_time,
        sequence: vaa_data.sequence,
        emitter_chain: vaa_data.emitter_chain,
        emitter_address: vaa_data.emitter_address,
        payload: vaa_data.payload.clone(),
        nonce: vaa_data.nonce,
        vaa_signature_account: vaa_data.vaa_signature_account,
        submission_time: 0,
    };
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
    let fast_market_order = FastMarketOrderState::new(
        order.amount_in,
        order.min_amount_out,
        order.deadline,
        order.target_chain,
        order.redeemer_message.len() as u16,
        order.redeemer,
        order.sender,
        order.refund_address,
        order.max_fee,
        order.init_auction_fee,
        redeemer_message_fixed_length,
        close_account_refund_recipient.to_bytes(),
        vaa_data.sequence,
        vaa_data.vaa_time,
        vaa_data.nonce,
        vaa_data.emitter_chain,
        vaa_data.consistency_level,
        vaa_data.emitter_address,
    );

    assert_eq!(fast_market_order.redeemer, order.redeemer);
    assert_eq!(
        vaa_message.digest(&fast_market_order).as_ref(),
        vaa_data.digest().as_ref()
    );

    (fast_market_order, vaa_data)
}
