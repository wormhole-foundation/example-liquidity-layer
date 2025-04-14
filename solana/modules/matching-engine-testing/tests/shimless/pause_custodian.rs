use std::rc::Rc;

use crate::testing_engine::config::ExpectedError;

use crate::testing_engine::state::TestingEngineState;

use anchor_lang::prelude::*;
use anchor_lang::InstructionData;
use matching_engine::accounts::AdminMut;

use crate::testing_engine::setup::TestingContext;

use matching_engine::accounts::SetPause as SetPauseAccounts;
use matching_engine::instruction::SetPause as SetPauseIx;
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Keypair;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;

/// Pause the custodian
///
/// # Arguments
///
/// * `test_context` - The test context
/// * `current_state` - The current state
/// * `config` - The config
///
/// # Returns
///
/// The new paused state
pub async fn set_pause(
    test_context: &mut ProgramTestContext,
    testing_context: &TestingContext,
    current_state: &TestingEngineState,
    owner_or_assistant: &Rc<Keypair>,
    expected_error: Option<&ExpectedError>,
    is_paused: bool,
) -> TestingEngineState {
    let custodian_address = current_state.initialized().unwrap().custodian_address;
    let admin_mut = AdminMut {
        owner_or_assistant: owner_or_assistant.pubkey(),
        custodian: custodian_address,
    };
    let accounts = SetPauseAccounts { admin: admin_mut };
    let instruction_data = SetPauseIx { pause: is_paused }.data();
    let instruction = Instruction {
        program_id: testing_context.get_matching_engine_program_id(),
        accounts: accounts.to_account_metas(None),
        data: instruction_data,
    };
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&owner_or_assistant.pubkey()),
        &[&owner_or_assistant],
        test_context.last_blockhash,
    );
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;

    let new_auction_state = current_state.auction_state().set_pause(is_paused);

    let expect_msg = format!(
        "Failed to set {} auction state",
        if is_paused { "pause" } else { "unpause" }
    );
    current_state
        .set_auction_state(new_auction_state)
        .expect(&expect_msg)
}
