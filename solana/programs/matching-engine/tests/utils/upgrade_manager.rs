use solana_program_test::ProgramTest;
use solana_sdk::pubkey::Pubkey;
use solana_program::bpf_loader_upgradeable;

// TODO: Use this function in the test
fn get_program_data(owner: Pubkey) -> Vec<u8> {
    let state = solana_sdk::bpf_loader_upgradeable::UpgradeableLoaderState::ProgramData {
        slot: 0,
        upgrade_authority_address: Some(owner),
    };
    bincode::serialize(&state).unwrap()
}

/// Initialise the upgrade manager program
/// 
/// Returns the program data pubkey
pub fn initialise_upgrade_manager(program_test: &mut ProgramTest, program_id: &Pubkey, owner_pubkey: Pubkey) -> Pubkey {
    let program_data_pubkey = Pubkey::find_program_address(
        &[program_id.as_ref()],
        &bpf_loader_upgradeable::id(),
    ).0;

    // Add the program data to the program test
    // Compute lamports from length of program data
    let program_data_data = get_program_data(owner_pubkey.clone());

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