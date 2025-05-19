//! # Program Fixtures
//!
//! This module provides fixtures for initializing programs on the Solana blockchain.
//! It includes functions to initialize the upgrade manager, CCTP token messenger minter,
//! wormhole core bridge, CCTP message transmitter, local token router, and verify shims.

use solana_program::bpf_loader_upgradeable;
use solana_program_test::ProgramTest;
use solana_sdk::pubkey::Pubkey;

use super::{
    CCTP_MESSAGE_TRANSMITTER_PID, CCTP_TOKEN_MESSENGER_MINTER_PID, CORE_BRIDGE_CONFIG,
    CORE_BRIDGE_PID, TOKEN_ROUTER_PID, WORMHOLE_POST_MESSAGE_SHIM_PID,
    WORMHOLE_VERIFY_VAA_SHIM_PID,
};

fn get_program_data(owner: Pubkey) -> Vec<u8> {
    let state = solana_sdk::bpf_loader_upgradeable::UpgradeableLoaderState::ProgramData {
        slot: 0,
        upgrade_authority_address: Some(owner),
    };
    bincode::serialize(&state).unwrap()
}

/// Initialize the upgrade manager program
///
/// Returns the program data pubkey
pub fn initialize_upgrade_manager(
    program_test: &mut ProgramTest,
    program_id: &Pubkey,
    owner_pubkey: Pubkey,
) -> Pubkey {
    let program_data_pubkey =
        Pubkey::find_program_address(&[program_id.as_ref()], &bpf_loader_upgradeable::id()).0;

    // Add the program data to the program test
    // Compute lamports from length of program data
    let program_data_data = get_program_data(owner_pubkey);

    let lamports = solana_sdk::rent::Rent::default().minimum_balance(program_data_data.len());
    let account = solana_sdk::account::Account {
        lamports,
        data: program_data_data,
        owner: bpf_loader_upgradeable::id(),
        executable: false,
        rent_epoch: u64::MAX,
    };

    program_test.add_account(program_data_pubkey, account);
    program_test.add_program("upgrade_manager", common::UPGRADE_MANAGER_PROGRAM_ID, None);

    program_data_pubkey
}

pub fn initialize_cctp_token_messenger_minter(program_test: &mut ProgramTest) {
    let program_id = CCTP_TOKEN_MESSENGER_MINTER_PID;
    program_test.add_program("mainnet_cctp_token_messenger_minter", program_id, None);
}

pub fn initialize_wormhole_core_bridge(program_test: &mut ProgramTest) {
    let program_id = CORE_BRIDGE_PID;
    program_test.add_program("mainnet_core_bridge", program_id, None);
}

pub fn initialize_cctp_message_transmitter(program_test: &mut ProgramTest) {
    let program_id = CCTP_MESSAGE_TRANSMITTER_PID;
    program_test.add_program("mainnet_cctp_message_transmitter", program_id, None);
}

pub fn initialize_local_token_router(program_test: &mut ProgramTest) {
    let program_id = TOKEN_ROUTER_PID;
    program_test.add_program("token_router", program_id, None);
}

pub fn initialize_post_message_shims(program_test: &mut ProgramTest) {
    let post_message_program_id = WORMHOLE_POST_MESSAGE_SHIM_PID;
    program_test.add_program("wormhole_post_message_shim", post_message_program_id, None);
    let verify_vaa_shim_program_id = WORMHOLE_VERIFY_VAA_SHIM_PID;
    program_test.add_program("wormhole_verify_vaa_shim", verify_vaa_shim_program_id, None);
}

pub fn initialize_verify_shims(program_test: &mut ProgramTest) {
    let verify_vaa_shim_program_id = WORMHOLE_VERIFY_VAA_SHIM_PID;
    program_test.add_program("wormhole_verify_vaa_shim", verify_vaa_shim_program_id, None);
    program_test.add_account_with_base64_data(
        CORE_BRIDGE_CONFIG,
        1_057_920,
        CORE_BRIDGE_PID,
        "BAAAAAQYDQ0AAAAAgFEBAGQAAAAAAAAA",
    );
    // Guardian set 4 (active).
    program_test.add_account_with_base64_data(
        wormhole_svm_definitions::find_guardian_set_address(u32::to_be_bytes(4), &CORE_BRIDGE_PID).0,
        3_647_040,
        CORE_BRIDGE_PID,
        "BAAAABMAAABYk7WnbD9zlkVkiIW9zMBs1wo80/9suVJYm96GLCXvQ5ITL7nUpCFXEU3oRgGTvfOi/PgfhqCXZfR2L9EQegCGsy16CXeSaiBRMdhzHTnL64yCsv2C+u0nEdWa8PJJnRbnJvayEbOXVsBCRBvm2GULabVOvnFeI0NUzltNNI+3S5WOiWbi7D29SVinzRXnyvB8Tj3I58Rp+SyM2I+4AFogdKO/kTlT1pUmDYi8GqJaTu42PvAACsAHZyezX76i2sKP7lzLD+p2jq9FztE2udniSQNGSuiJ9cinI/wU+TEkt8c4hDy7iehkyGLDjN3Mz5XSzDek3ANqjSMrSPYs3UcxQS9IkNp5j2iWozMfZLSMEtHVf9nL5wgRcaob4dNsr+OGeRD5nAnjR4mcGcOBkrbnOHzNdoJ3wX2rG3pQJ8CzzxeOIa0ud64GcRVJz7sfnHqdgJboXhSH81UV0CqSdTUEqNdUcbn0nttvvryJj0A+R3PpX+sV6Ayamcg0jXiZHmYAAAAA",
    );
    // Guardian set 3 (expired).
    program_test.add_account_with_base64_data(
        wormhole_svm_definitions::find_guardian_set_address(u32::to_be_bytes(3), &CORE_BRIDGE_PID).0,
        3_647_040,
        CORE_BRIDGE_PID,
        "AwAAABMAAABYzDrlwJeyE848gZeeG5+VcHRqpf9suVJYm96GLCXvQ5ITL7nUpCFXEU3oRgGTvfOi/PgfhqCXZfR2L9EQegCGsy16CXeSaiBRMdhzHTnL64yCsv2C+u0nEdWa8PJJnRbnJvayEbOXVsBCRBvm2GULabVOvnFeI0NUzltNNI+3S5WOiWbi7D29SVinzRXnyvB8Tj3I58Rp+SyM2I+4AFogdKO/kTlT1pUmDYi8GqJaTu42PvAACsAHZyezX76i2sKP7lzLD+p2jq9FztE2udniSQNGSuiJ9cinI/wU+TEkt8c4hDy7iehkyGLDjN3Mz5XSzDek3ANqjSMrSPYs3UcxQS9IkNp5j2iWozMfZLSMEtHVf9nL5wgRcaob4dNsr+OGeRD5nAnjR4mcGcOBkrbnOHzNdoJ3wX2rG3pQJ8CzzxeOIa0ud64GcRVJz7sfnHqdgJboXhSH81UV0CqSdTUEqNdUcbn0nttvvryJj0A+R3PpX+sV6Ayamcg0jUA8xWP46h9m",
    );
    program_test.prefer_bpf(true);
}
