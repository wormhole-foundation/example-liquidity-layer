//! # Account Fixtures
//!
//! This module provides fixtures for creating accounts in the test environment.
//! It includes methods for creating accounts and for reading a keypair from a JSON fixture file.
//! These accounts are located in the `tests/fixtures/accounts` directory.

use anchor_lang::prelude::Pubkey;
use anyhow::Result as AnyhowResult;
use serde_json::Value;
use solana_program_test::ProgramTest;
use std::{fs, str::FromStr};

#[derive(Clone)]
pub struct FixtureAccounts {
    // Accounts/Core
    pub core_bridge_config: Pubkey,
    pub core_fee_collector: Pubkey,
    pub core_guardian_set: Pubkey,
    // Accounts/Message_Transmitter
    pub message_transmitter_config: Pubkey,
    // Accounts/Testnet
    pub matching_engine_custodian: Pubkey,
    pub token_router_custodian: Pubkey,
    pub token_router_program: Pubkey,
    // Accounts/Token_Messenger_Minter
    pub arbitrum_remote_token_messenger: Pubkey,
    pub ethereum_remote_token_messenger: Pubkey,
    pub misconfigured_remote_token_messenger: Pubkey,
    pub token_messenger: Pubkey,
    pub token_minter: Pubkey,
    pub usdc_custody_token: Pubkey,
    pub usdc_local_token: Pubkey, // CCTP account (something that one of the programs use to track something)
    pub usdc_token_pair: Pubkey, // Account that pairs links (in this case usdc solana) with usdc on another network
}

impl FixtureAccounts {
    /// Initialises all accounts in fixtures directory
    ///
    /// # Arguments
    ///
    /// * `program_test` - The program test instance
    ///
    /// # Returns
    ///
    /// A FixtureAccounts struct containing the addresses of all the accounts
    pub fn new(program_test: &mut ProgramTest) -> Self {
        // Since matching_engine_custodian is initialized by the test, we can just use the pubkey
        Self {
            core_bridge_config: add_account_from_file(program_test, "tests/fixtures/accounts/core_bridge/config.json").address,
            core_fee_collector: add_account_from_file(program_test, "tests/fixtures/accounts/core_bridge/fee_collector.json").address,
            core_guardian_set: add_account_from_file(program_test, "tests/fixtures/accounts/core_bridge/guardian_set_0.json").address,
            message_transmitter_config: add_account_from_file(program_test, "tests/fixtures/accounts/message_transmitter/message_transmitter_config.json").address,
            // matching_engine_custodian: add_account_from_file(program_test, "tests/fixtures/accounts/testnet/matching_engine_custodian.json").address,
            matching_engine_custodian: Pubkey::from_str("5BsCKkzuZXLygduw6RorCqEB61AdzNkxp5VzQrFGzYWr").unwrap(),
            token_router_custodian: add_account_from_file(program_test, "tests/fixtures/accounts/testnet/token_router_custodian.json").address,
            token_router_program: add_account_from_file(program_test, "tests/fixtures/accounts/testnet/token_router_program_data_hacked.json").address,
            arbitrum_remote_token_messenger: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/arbitrum_remote_token_messenger.json").address,
            ethereum_remote_token_messenger: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/ethereum_remote_token_messenger.json").address,
            misconfigured_remote_token_messenger: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/misconfigured_remote_token_messenger.json").address,
            token_messenger: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/token_messenger.json").address,
            token_minter: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/token_minter.json").address,
            usdc_custody_token: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/usdc_custody_token.json").address,
            usdc_local_token: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/usdc_local_token.json").address,
            usdc_token_pair: add_account_from_file(program_test, "tests/fixtures/accounts/token_messenger_minter/usdc_token_pair.json").address,
        }
    }
    /// Adds a lookup table to the program test
    ///
    /// # Arguments
    ///
    /// * `program_test` - The program test instance
    pub fn add_lookup_table_hack(program_test: &mut ProgramTest) {
        let filename = "tests/fixtures/lut.json";
        let account_fixture = read_account_from_file(filename).unwrap();
        program_test.add_account_with_file_data(
            account_fixture.address,
            account_fixture.lamports,
            account_fixture.owner,
            filename,
        );
    }
}

/// Adds an account from a JSON fixture file to the program test
///
/// Loads the JSON file and parses it into a Value object that is used to extract the lamports, address, and owner values.
///
/// # Arguments
///
/// * `program_test` - The program test instance
/// * `filename` - The path to the JSON fixture file
fn add_account_from_file(program_test: &mut ProgramTest, filename: &str) -> AccountFixture {
    // Parse the JSON file to an AccountFixture struct
    let account_fixture = read_account_from_file(filename).unwrap();
    // Add the account to the program test
    program_test.add_account_with_base64_data(
        account_fixture.address,
        account_fixture.lamports,
        account_fixture.owner,
        &account_fixture.base_64_data,
    );
    account_fixture
}

struct AccountFixture {
    pub address: Pubkey,
    pub owner: Pubkey,
    pub lamports: u64,
    pub base_64_data: String,
}

/// Reads an account from a JSON fixture file
///
/// Reads the JSON file and parses it into a Value object that is used to extract the lamports, address, and owner values.
///
/// # Arguments
///
/// * `filename` - The path to the JSON fixture file
///
/// # Returns
///
/// An AccountFixture struct containing the address, owner, lamports, and filename.
fn read_account_from_file(filename: &str) -> AnyhowResult<AccountFixture> {
    // Read the JSON file
    let data = fs::read_to_string(filename)?;

    // Parse the JSON
    let json: Value = serde_json::from_str(&data)?;

    // Extract the lamports value
    let lamports = json["account"]["lamports"]
        .as_u64()
        .unwrap_or_else(|| panic!("lamports field not found or invalid {}", filename));

    // Extract the address value
    let address: Pubkey = solana_sdk::pubkey::Pubkey::from_str(
        json["pubkey"]
            .as_str()
            .expect("pubkey field not found or invalid"),
    )
    .expect("Pubkey field in file is not a valid pubkey");
    // Extract the owner address value
    let owner: Pubkey = solana_sdk::pubkey::Pubkey::from_str(
        json["account"]["owner"]
            .as_str()
            .expect("owner field not found or invalid"),
    )
    .expect("Owner field in file is not a valid pubkey");

    let base_64_data = json["account"]["data"][0]
        .as_str()
        .expect("data field not found or invalid");
    Ok(AccountFixture {
        address,
        owner,
        lamports,
        base_64_data: base_64_data.to_string(),
    })
}
