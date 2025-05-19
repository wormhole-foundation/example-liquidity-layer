use crate::testing_engine::setup::TestingContext;
use crate::utils::constants::*;

use solana_program_test::ProgramTestContext;
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    hash::Hash,
    message::{v0::Message, VersionedMessage},
    signature::{Keypair, Signer},
    transaction::VersionedTransaction,
};

use std::rc::Rc;
use wormhole_svm_definitions::{
    find_emitter_sequence_address, find_shim_message_address, solana::Finality,
};
use wormhole_svm_shim::post_message;

/// Bump costs
///
/// This struct contains the bump costs for the message and sequence
///
/// # Fields
///
/// * `message` - The bump cost for the message
/// * `sequence` - The bump cost for the sequence
pub struct BumpCosts {
    pub message: u64,
    pub sequence: u64,
}

impl BumpCosts {
    fn from_message_and_sequence_bump(message_bump: u8, sequence_bump: u8) -> Self {
        Self {
            message: Self::bump_cu_cost(message_bump),
            sequence: Self::bump_cu_cost(sequence_bump),
        }
    }

    fn bump_cu_cost(bump: u8) -> u64 {
        1_500_u64.saturating_mul(255_u64.saturating_sub(u64::from(bump)))
    }
}

/// Set up post message transaction test
///
/// This function executes a post message transaction and asserts the correct logs are emitted
///
/// # Arguments
///
/// * `test_ctx` - The test context
/// * `payer_signer` - The payer signer keypair
/// * `emitter_signer` - The emitter signer keypair
pub async fn set_up_post_message_transaction_test(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    payer_signer: &Rc<Keypair>,
    emitter_signer: &Rc<Keypair>,
) {
    let recent_blockhash = testing_context
        .get_new_latest_blockhash(test_context)
        .await
        .expect("Could not get last blockhash");
    let (transaction, _bump_costs) = set_up_post_message_transaction(
        b"All your base are belong to us",
        &payer_signer.clone().to_owned(),
        &emitter_signer.clone().to_owned(),
        recent_blockhash,
    );
    let details = {
        let out = test_context
            .banks_client
            .simulate_transaction(transaction)
            .await
            .unwrap();
        assert!(out.result.clone().unwrap().is_ok(), "{:?}", out.result);
        out.simulation_details.unwrap()
    };
    let logs = details.logs;
    let is_core_bridge_cpi_log =
        |line: &String| line.contains(format!("Program {} invoke [2]", CORE_BRIDGE_PID).as_str());
    // CPI to Core Bridge.
    assert_eq!(
        logs.iter()
            .filter(|line| {
                line.contains(format!("Program {} invoke [2]", CORE_BRIDGE_PID).as_str())
            })
            .count(),
        1
    );
    assert_eq!(
        logs.iter()
            .filter(|line| { line.contains("Program log: Sequence: 0") })
            .count(),
        1
    );
    let core_bridge_log_index = logs.iter().position(is_core_bridge_cpi_log).unwrap();

    // Self CPI.
    assert_eq!(
        logs.iter()
            .skip(core_bridge_log_index)
            .filter(|line| {
                line.contains(
                    format!("Program {} invoke [2]", WORMHOLE_POST_MESSAGE_SHIM_PID).as_str(),
                )
            })
            .count(),
        1
    );
}

/// Set up post message transaction
///
/// This function sets up a post message transaction
///
/// # Arguments
///
/// * `payload` - The payload to post
/// * `payer_signer` - The payer signer
/// * `emitter_signer` - The emitter signer
/// * `recent_blockhash` - The recent blockhash
///
/// # Returns
///
/// * `VersionedTransaction` - The versioned transaction that can be executed to post the message
/// * `BumpCosts` - The bump costs for the message and sequence
fn set_up_post_message_transaction(
    payload: &[u8],
    payer_signer: &Keypair,
    emitter_signer: &Keypair,
    recent_blockhash: Hash,
) -> (VersionedTransaction, BumpCosts) {
    let emitter = emitter_signer.pubkey();
    let payer = payer_signer.pubkey();

    // Use an invalid message if provided.
    let (message, message_bump) =
        find_shim_message_address(&emitter, &WORMHOLE_POST_MESSAGE_SHIM_PID);

    // Use an invalid core bridge program if provided.
    let core_bridge_program = CORE_BRIDGE_PID;

    let (sequence, sequence_bump) = find_emitter_sequence_address(&emitter, &core_bridge_program);

    let transfer_fee_ix =
        solana_sdk::system_instruction::transfer(&payer, &CORE_BRIDGE_FEE_COLLECTOR, 100);
    let post_message_ix = post_message::PostMessage {
        program_id: &WORMHOLE_POST_MESSAGE_SHIM_PID,
        accounts: post_message::PostMessageAccounts {
            emitter: &emitter,
            payer: &payer,
            wormhole_program_id: &core_bridge_program,
            derived: post_message::PostMessageDerivedAccounts {
                message: Some(&message),
                sequence: Some(&sequence),
                ..Default::default()
            },
        },
        data: post_message::PostMessageData::new(420, Finality::Finalized, payload).unwrap(),
    }
    .instruction();

    // Adding compute budget instructions to ensure all instructions fit into
    // one transaction.
    //
    // NOTE: Invoking the compute budget costs in total 300 CU.
    let message = Message::try_compile(
        &payer,
        &[
            transfer_fee_ix,
            post_message_ix,
            ComputeBudgetInstruction::set_compute_unit_price(420),
            ComputeBudgetInstruction::set_compute_unit_limit(100_000),
        ],
        &[],
        recent_blockhash,
    )
    .unwrap();

    let transaction = VersionedTransaction::try_new(
        VersionedMessage::V0(message),
        &[payer_signer, emitter_signer],
    )
    .unwrap();

    (
        transaction,
        BumpCosts::from_message_and_sequence_bump(message_bump, sequence_bump),
    )
}
