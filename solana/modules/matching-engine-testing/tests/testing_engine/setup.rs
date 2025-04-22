//! # Testing Engine Setup
//!
//! This module contains the setup for the testing engine.
//! It is used to create the pre-testing context and the testing context.
//!
//! ## Examples
//!
//! ```
//! use crate::testing_engine::setup::*;
//!
//! let testing_context = setup_testing_context(//arguments);
//! let testing_engine = TestingEngine::new(testing_context).await;
//! ```

use crate::testing_engine::config::{ExpectedError, ExpectedLog};
use crate::utils::account_fixtures::FixtureAccounts;
use crate::utils::airdrop::{airdrop, airdrop_spl_token};
use crate::utils::cctp_message::CctpRemoteTokenMessenger;
use crate::utils::mint::MintFixture;
use crate::utils::program_fixtures::{
    initialise_cctp_message_transmitter, initialise_cctp_token_messenger_minter,
    initialise_local_token_router, initialise_post_message_shims, initialise_upgrade_manager,
    initialise_verify_shims, initialise_wormhole_core_bridge,
};
use crate::utils::token_account::{
    create_token_account, read_keypair_from_file, SplTokenEnum, TokenAccountFixture,
};
use crate::utils::vaa::{
    create_vaas_test_with_chain_and_address, ChainAndAddress, TestVaaPair, TestVaaPairs, VaaArgs,
};
use crate::utils::{Chain, REGISTERED_TOKEN_ROUTERS};
use anchor_lang::AccountDeserialize;
use anchor_spl::token::{
    spl_token::{self, instruction::approve},
    TokenAccount,
};
use anyhow::Result as AnyhowResult;
use matching_engine::{CCTP_MINT_RECIPIENT, ID as PROGRAM_ID};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::clock::Clock;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::instruction::{Instruction, InstructionError};
use solana_sdk::transaction::{TransactionError, VersionedTransaction};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::collections::HashMap;
use std::ops::Deref;
use std::rc::Rc;

use super::config::TestingActorEnum;

// Configures the program ID and CCTP mint recipient based on the environment
cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        //const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("5BsCKkzuZXLygduw6RorCqEB61AdzNkxp5VzQrFGzYWr");
        //const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("HUXc7MBf55vWrrkevVbmJN8HAyfFtjLcPLBt9yWngKzm");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        const USDT_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint.json";
        const USDT_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdt_mint.json";
    } else if #[cfg(feature = "testnet")] {
        //const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS");
        //const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("6yKmqWarCry3c8ntYKzM4WiS2fVypxLbENE2fP8onJje");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
        const USDT_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint_devnet.json";
        const USDT_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdt_mint.json";
    } else if #[cfg(feature = "localnet")] {
        //const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("MatchingEngine11111111111111111111111111111");
        // const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("35iwWKi7ebFyXNaqpswd1g9e9jrjvqWPV39nCQPaBbX1");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
        const USDT_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint_devnet.json";
        const USDT_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdt_mint.json";
    }
}
const OWNER_KEYPAIR_PATH: &str = "tests/keys/pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ.json";

/// The pre-testing context struct stores data that for the program before the solana-program-test context is created
///
/// # Fields
///
/// * `program_test` - The program test
/// * `testing_actors` - The testing actors
/// * `program_data_pubkey` - The pubkey of the program data account
/// * `account_fixtures` - The account fixtures
pub struct PreTestingContext {
    pub program_test: ProgramTest,
    pub testing_actors: TestingActors,
    pub program_data_pubkey: Pubkey,
    pub account_fixtures: FixtureAccounts,
}

impl PreTestingContext {
    /// Setup the pre-test context
    ///
    /// # Returns
    ///
    /// A PreTestingContext struct containing the program data account, testing actors, test context, and fixture accounts
    pub fn new(program_id: Pubkey, owner_keypair_path: &str) -> Self {
        let mut program_test = ProgramTest::new(
            "matching_engine", // Replace with your program name
            program_id,
            None,
        );

        program_test.set_compute_max_units(1000000000);
        program_test.set_transaction_account_lock_limit(1000);

        // Setup Testing Actors
        let testing_actors = TestingActors::new(owner_keypair_path);
        println!("Testing actors: {:?}", testing_actors);
        // Initialise Upgrade Manager
        let program_data_pubkey = initialise_upgrade_manager(
            &mut program_test,
            &program_id,
            testing_actors.owner.pubkey(),
        );

        // Initialise CCTP Token Messenger Minter
        initialise_cctp_token_messenger_minter(&mut program_test);

        // Initialise Wormhole Core Bridge
        initialise_wormhole_core_bridge(&mut program_test);

        // Initialise CCTP Message Transmitter
        initialise_cctp_message_transmitter(&mut program_test);

        // Initialise Local Token Router
        initialise_local_token_router(&mut program_test);

        // Initialise Account Fixtures
        let account_fixtures = FixtureAccounts::new(&mut program_test);

        // Add lookup table accounts
        FixtureAccounts::add_lookup_table_hack(&mut program_test);

        PreTestingContext {
            program_test,
            testing_actors,
            program_data_pubkey,
            account_fixtures,
        }
    }

    /// Adds the post message shims to the program test
    pub fn add_post_message_shims(&mut self) {
        initialise_post_message_shims(&mut self.program_test);
    }

    /// Adds the verify shims to the program test
    pub fn add_verify_shims(&mut self) {
        initialise_verify_shims(&mut self.program_test);
    }
}

/// Testing Context struct that stores common data needed to run tests
///
/// # Fields
///
/// * `program_data_account` - The pubkey of the program data account created by the Upgrade Manager
/// * `testing_actors` - The testing actors, including solvers and the owner
/// * `fixture_accounts` - The accounts that are loaded from files under the `tests/fixtures` directory
/// * `vaa_pairs` - The Vaas that were created in the pre-testing context setup stage
pub struct TestingContext {
    pub program_data_account: Pubkey,
    pub testing_actors: TestingActors,
    pub fixture_accounts: Option<FixtureAccounts>,
    pub vaa_pairs: TestVaaPairs,
    pub transfer_direction: TransferDirection,
    pub shim_mode: ShimMode,
}

impl TestingContext {
    /// Creates a new TestingContext
    ///
    /// # Arguments
    ///
    /// * `pre_testing_context` - The pre-testing context
    /// * `transfer_direction` - The transfer direction
    /// * `vaas_test` - The Vaas that were created in the pre-testing context setup stage
    ///
    /// # Returns
    ///
    /// A tuple containing the new TestingContext and the test context from the solana-program-test crate
    pub async fn new(
        mut pre_testing_context: PreTestingContext,
        transfer_direction: TransferDirection,
        vaas_test: Option<TestVaaPairs>,
        shim_mode: ShimMode,
    ) -> (Self, ProgramTestContext) {
        let mut test_context = pre_testing_context.program_test.start_with_context().await;

        // Airdrop to all actors
        pre_testing_context
            .testing_actors
            .airdrop_all(&mut test_context)
            .await;

        // Create USDC mint
        let _usdc_mint_fixture =
            MintFixture::new_from_file(&mut test_context, USDC_MINT_FIXTURE_PATH);
        let _usdt_mint_fixture =
            MintFixture::new_from_file(&mut test_context, USDT_MINT_FIXTURE_PATH);

        // Create USDC ATAs for all actors that need them
        pre_testing_context
            .testing_actors
            .create_usdc_atas(&mut test_context, USDC_MINT_ADDRESS)
            .await;

        pre_testing_context
            .testing_actors
            .create_usdt_atas(&mut test_context, USDT_MINT_ADDRESS)
            .await;
        let vaa_pairs = match vaas_test {
            Some(vaas_test) => vaas_test,
            None => TestVaaPairs::new(),
        };
        (
            TestingContext {
                program_data_account: pre_testing_context.program_data_pubkey,
                testing_actors: pre_testing_context.testing_actors,
                fixture_accounts: Some(pre_testing_context.account_fixtures),
                vaa_pairs,
                transfer_direction,
                shim_mode,
            },
            test_context,
        )
    }

    /// Verifies the posted VAA pairs
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    pub async fn verify_vaas(&self, test_context: &mut ProgramTestContext) {
        self.vaa_pairs.verify_posted_vaas(test_context).await;
    }

    /// Gets the VAA pair at the given index
    ///
    /// # Arguments
    ///
    /// * `index` - The index of the VAA pair
    pub fn get_vaa_pair(&self, index: usize) -> Option<TestVaaPair> {
        if index < self.vaa_pairs.len() {
            Some(self.vaa_pairs[index].clone())
        } else {
            None
        }
    }

    /// Gets the fixture accounts
    ///
    /// # Returns
    ///
    /// The fixture accounts
    pub fn get_fixture_accounts(&self) -> Option<FixtureAccounts> {
        self.fixture_accounts.clone()
    }

    /// Gets the matching engine program ID
    ///
    /// # Returns
    ///
    /// The matching engine program ID
    pub fn get_matching_engine_program_id(&self) -> Pubkey {
        PROGRAM_ID
    }

    /// Gets the USDC mint address
    ///
    /// # Returns
    ///
    /// The USDC mint address
    pub fn get_usdc_mint_address(&self) -> Pubkey {
        USDC_MINT_ADDRESS
    }

    /// Gets the CCTP mint recipient
    ///
    /// # Returns
    ///
    /// The CCTP mint recipient
    pub fn get_cctp_mint_recipient(&self) -> Pubkey {
        CCTP_MINT_RECIPIENT
    }

    /// Gets the Wormhole program ID
    ///
    /// # Returns
    ///
    /// The Wormhole program ID
    pub fn get_wormhole_program_id(&self) -> Pubkey {
        wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID
    }

    /// Gets the new latest blockhash
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    pub async fn get_new_latest_blockhash(
        &self,
        test_context: &mut ProgramTestContext,
    ) -> AnyhowResult<solana_program::hash::Hash> {
        let handle = test_context.get_new_latest_blockhash();
        let hash = handle.await?;
        Ok(hash)
    }

    /// Processes a transaction
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    /// * `transaction` - The transaction to process
    pub async fn process_transaction(
        &self,
        test_context: &mut ProgramTestContext,
        transaction: impl Into<VersionedTransaction>,
    ) -> Result<(), BanksClientError> {
        let handle = test_context.banks_client.process_transaction(transaction);
        handle.await
    }

    /// Simulates a transaction and verifies that the logs contain the expected lines
    ///
    /// # Arguments
    ///
    /// * `transaction` - The transaction to simulate
    /// * `expected_logs` - A vector of strings that should be present in the logs
    ///
    /// # Returns
    ///
    /// The simulation details if the transaction was successful and all expected logs were found
    pub async fn simulate_and_verify_logs(
        &self,
        test_context: &mut ProgramTestContext,
        transaction: impl Into<VersionedTransaction>,
        expected_logs: &Vec<ExpectedLog>,
    ) -> AnyhowResult<()> {
        let simulation_result = test_context
            .banks_client
            .simulate_transaction(transaction)
            .await?;
        // Verify the transaction succeeded
        assert!(
            simulation_result.result.clone().unwrap().is_ok(),
            "Transaction simulation failed: {:?}",
            simulation_result.result
        );

        let details = simulation_result
            .simulation_details
            .expect("No simulation details available");

        // Verify all expected logs are present
        for expected_log in expected_logs {
            let expected_log_count = expected_log.count;
            let expected_log_message = &expected_log.log_message;
            let found = details
                .logs
                .iter()
                .filter(|log| log.contains(expected_log_message))
                .count();
            assert!(
                found == expected_log_count,
                "Expected log {} not found in program logs",
                expected_log.log_message
            );
        }
        Ok(())
    }

    pub async fn create_transaction(
        &self,
        test_context: &mut ProgramTestContext,
        instructions: &[Instruction],
        payer: Option<&Pubkey>,
        signers: &[&Keypair],
        compute_unit_price: u64,
        compute_unit_limit: u32,
    ) -> Transaction {
        let last_blockhash = self.get_new_latest_blockhash(test_context).await.unwrap();
        let compute_budget_price =
            ComputeBudgetInstruction::set_compute_unit_price(compute_unit_price);
        let compute_budget_limit =
            ComputeBudgetInstruction::set_compute_unit_limit(compute_unit_limit);
        let mut all_instructions = Vec::with_capacity(instructions.len() + 2);
        all_instructions.push(compute_budget_price.clone());
        all_instructions.push(compute_budget_limit.clone());
        all_instructions.extend_from_slice(instructions);
        Transaction::new_signed_with_payer(&all_instructions, payer, signers, last_blockhash)
    }

    // TODO: Edit to handle multiple instructions in a single transaction
    pub async fn execute_and_verify_transaction(
        &self,
        test_context: &mut ProgramTestContext,
        transaction: impl Into<VersionedTransaction>,
        expected_error: Option<&ExpectedError>,
    ) {
        let tx_result = self.process_transaction(test_context, transaction).await;
        if let Some(expected_error) = expected_error {
            let tx_error = tx_result.expect_err(&format!(
                "Expected error {:?}, but transaction succeeded",
                expected_error.error_string
            ));

            match tx_error {
                BanksClientError::TransactionError(TransactionError::InstructionError(
                    instruction_index,
                    InstructionError::Custom(error_code),
                )) => {
                    assert_eq!(
                        instruction_index, expected_error.instruction_index,
                        "Expected error on instruction {}, but got: {:?}",
                        expected_error.instruction_index, tx_error
                    );
                    assert_eq!(
                        error_code, expected_error.error_code,
                        "Program returned error code {}, expected {} ({:?})",
                        error_code, expected_error.error_code, expected_error.error_string
                    );
                }
                _ => {
                    panic!(
                        "Expected program error {:?}, but got: {:?}",
                        expected_error.error_string, tx_error
                    );
                }
            }
        } else {
            assert!(
                tx_result.is_ok(),
                "Transaction failed but no error was expected: {:?}",
                tx_result.err().unwrap()
            );
        }
    }

    /// Gets the balances of all the test actors
    pub async fn get_balances(&self, test_context: &mut ProgramTestContext) -> Balances {
        Balances::new(&self.testing_actors, test_context).await
    }

    pub async fn get_current_timestamp(&self, test_context: &mut ProgramTestContext) -> i64 {
        let clock = test_context
            .banks_client
            .get_sysvar::<Clock>()
            .await
            .expect("Failed to get clock sysvar");
        clock.unix_timestamp
    }

    pub async fn fast_forward_to_timestamp(
        &self,
        test_context: &mut ProgramTestContext,
        target_timestamp: i64,
    ) {
        let new_clock = Clock {
            unix_timestamp: target_timestamp,
            ..Default::default()
        };
        test_context.set_sysvar(&new_clock);
        let current_timestamp = self.get_current_timestamp(test_context).await;
        assert!(current_timestamp >= target_timestamp);
    }

    pub async fn make_fast_transfer_vaa_expired(
        &self,
        test_context: &mut ProgramTestContext,
        seconds_after_expiry: i64, // Make this negative if you want it slightly before expiry
    ) {
        let vaa_expiration_time = i64::from(
            self.get_vaa_pair(0)
                .unwrap()
                .get_fast_transfer_vaa_expiration_time(),
        );
        let target_timestamp = vaa_expiration_time + seconds_after_expiry;
        self.fast_forward_to_timestamp(test_context, target_timestamp)
            .await;
    }

    pub async fn get_remote_token_messenger(
        &self,
        test_context: &mut ProgramTestContext,
    ) -> CctpRemoteTokenMessenger {
        let fixture_accounts = self.get_fixture_accounts().unwrap();
        match self.transfer_direction {
            TransferDirection::FromEthereumToArbitrum => {
                crate::utils::router::get_remote_token_messenger(
                    test_context,
                    fixture_accounts.ethereum_remote_token_messenger,
                )
                .await
                .into()
            }
            TransferDirection::FromArbitrumToEthereum => {
                crate::utils::router::get_remote_token_messenger(
                    test_context,
                    fixture_accounts.arbitrum_remote_token_messenger,
                )
                .await
                .into()
            }
            TransferDirection::Other => {
                panic!("Unsupported transfer direction");
            }
        }
    }
}

/// A struct representing a solver
///
/// # Fields
///
/// * `actor` - The testing actor
#[derive(Clone)]
pub struct Solver {
    pub actor: TestingActor,
}

impl Solver {
    pub fn new(
        keypair: Rc<Keypair>,
        usdc_token_account: Option<TokenAccountFixture>,
        usdt_token_account: Option<TokenAccountFixture>,
    ) -> Self {
        Self {
            actor: TestingActor::new(keypair, usdc_token_account, usdt_token_account),
        }
    }

    pub fn keypair(&self) -> Rc<Keypair> {
        self.actor.keypair.clone()
    }

    pub fn pubkey(&self) -> Pubkey {
        self.actor.keypair.pubkey()
    }

    pub fn token_account_address(&self) -> Option<Pubkey> {
        self.actor.usdc_token_account.as_ref().map(|t| t.address)
    }

    /// Approves the USDC mint for the given delegate
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    /// * `delegate` - The delegate to approve the USDC mint to
    /// * `amount` - The amount of USDC to approve
    pub async fn approve_spl_token(
        &self,
        test_context: &mut ProgramTestContext,
        delegate: &Pubkey,
        amount: u64,
        spl_token_enum: &SplTokenEnum,
    ) {
        self.actor
            .approve_spl_token(test_context, delegate, amount, spl_token_enum)
            .await;
    }

    pub async fn get_token_account_balance(
        &self,
        test_context: &mut ProgramTestContext,
        spl_token_enum: &SplTokenEnum,
    ) -> u64 {
        self.actor
            .get_token_account_balance(test_context, spl_token_enum)
            .await
    }

    pub async fn get_lamport_balance(&self, test_context: &mut ProgramTestContext) -> u64 {
        self.actor.get_lamport_balance(test_context).await
    }
}

/// A struct representing a testing actor
///
/// # Fields
///
/// * `keypair` - The keypair of the actor
/// * `token_account` - The token account of the actor (if it exists)
#[derive(Clone)]
pub struct TestingActor {
    pub keypair: Rc<Keypair>,
    pub usdc_token_account: Option<TokenAccountFixture>,
    pub usdt_token_account: Option<TokenAccountFixture>,
}

impl std::fmt::Debug for TestingActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "TestingActor {{ pubkey: {:?}, token_account: {:?} }}",
            self.keypair.pubkey(),
            self.usdc_token_account
        )
    }
}

impl TestingActor {
    pub fn new(
        keypair: Rc<Keypair>,
        usdc_token_account: Option<TokenAccountFixture>,
        usdt_token_account: Option<TokenAccountFixture>,
    ) -> Self {
        Self {
            keypair,
            usdc_token_account,
            usdt_token_account,
        }
    }
    pub fn pubkey(&self) -> Pubkey {
        self.keypair.pubkey()
    }
    pub fn keypair(&self) -> Rc<Keypair> {
        self.keypair.clone()
    }

    pub fn token_account_address(&self, spl_token_enum: &SplTokenEnum) -> Option<Pubkey> {
        match spl_token_enum {
            SplTokenEnum::Usdc => self.usdc_token_account.as_ref().map(|t| t.address),
            SplTokenEnum::Usdt => self.usdt_token_account.as_ref().map(|t| t.address),
        }
    }

    /// Gets the balance of the token account
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    pub async fn get_token_account_balance(
        &self,
        test_context: &mut ProgramTestContext,
        spl_token_enum: &SplTokenEnum,
    ) -> u64 {
        if let Some(token_account) = self.token_account_address(spl_token_enum) {
            if let Some(account) = test_context
                .banks_client
                .get_account(token_account)
                .await
                .unwrap()
            {
                let token_account = TokenAccount::try_deserialize(&mut &account.data[..]).unwrap();
                token_account.amount
            } else {
                0
            }
        } else {
            0
        }
    }

    pub async fn get_lamport_balance(&self, test_context: &mut ProgramTestContext) -> u64 {
        test_context
            .banks_client
            .get_balance(self.keypair.pubkey())
            .await
            .unwrap()
    }

    /// Approves the USDC mint for the given delegate
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    /// * `delegate` - The delegate to approve the USDC mint to
    /// * `amount` - The amount of USDC to approve
    pub async fn approve_spl_token(
        &self,
        test_context: &mut ProgramTestContext,
        delegate: &Pubkey,
        amount: u64,
        spl_token_enum: &SplTokenEnum,
    ) {
        // If signer pubkeys are empty, it means that the owner is the signer
        let last_blockhash = test_context
            .get_new_latest_blockhash()
            .await
            .expect("Failed to get new blockhash");
        let approve_ix = approve(
            &spl_token::ID,
            &self.token_account_address(spl_token_enum).unwrap(),
            delegate,
            &self.pubkey(),
            &[],
            amount,
        )
        .expect("Failed to create approve USDC instruction");
        let transaction = Transaction::new_signed_with_payer(
            &[approve_ix],
            Some(&self.pubkey()),
            &[&self.keypair()],
            last_blockhash,
        );
        test_context
            .banks_client
            .process_transaction(transaction)
            .await
            .expect("Failed to approve USDC");
    }

    pub async fn close_token_account(
        &self,
        test_context: &mut ProgramTestContext,
        spl_token_enum: &SplTokenEnum,
    ) {
        if let Some(token_account) = self.token_account_address(spl_token_enum) {
            let balance = self
                .get_token_account_balance(test_context, spl_token_enum)
                .await;
            let burn_ix = spl_token::instruction::burn(
                &spl_token::ID,
                &token_account,
                &USDC_MINT_ADDRESS,
                &self.pubkey(),
                &[],
                balance,
            )
            .unwrap();
            let last_blockhash = test_context
                .get_new_latest_blockhash()
                .await
                .expect("Failed to get new blockhash");
            let transaction = Transaction::new_signed_with_payer(
                &[burn_ix],
                Some(&self.pubkey()),
                &[&self.keypair()],
                last_blockhash,
            );
            test_context
                .banks_client
                .process_transaction(transaction)
                .await
                .expect("Failed to burn token account");
            let close_account_ix = spl_token::instruction::close_account(
                &spl_token::ID,
                &token_account,
                &self.pubkey(),
                &self.pubkey(),
                &[],
            )
            .unwrap();
            let last_blockhash = test_context
                .get_new_latest_blockhash()
                .await
                .expect("Failed to get new blockhash");
            let transaction = Transaction::new_signed_with_payer(
                &[close_account_ix],
                Some(&self.pubkey()),
                &[&self.keypair()],
                last_blockhash,
            );
            test_context
                .banks_client
                .process_transaction(transaction)
                .await
                .expect("Failed to close token account");
        }
    }
}

/// A struct containing the balances of all the test actors
#[derive(Debug, Clone)]
pub struct Balances(HashMap<TestingActorEnum, Balance>);

impl Deref for Balances {
    type Target = HashMap<TestingActorEnum, Balance>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Balances {
    pub fn get(&self, actor: &TestingActorEnum) -> Option<&Balance> {
        self.0.get(actor)
    }
}

impl Balances {
    pub async fn new(
        testing_actors: &TestingActors,
        test_context: &mut ProgramTestContext,
    ) -> Self {
        let mut balances = HashMap::new();
        balances.insert(
            TestingActorEnum::Owner,
            Balance::new(&testing_actors.owner, test_context).await,
        );
        balances.insert(
            TestingActorEnum::OwnerAssistant,
            Balance::new(&testing_actors.owner_assistant, test_context).await,
        );
        balances.insert(
            TestingActorEnum::FeeRecipient,
            Balance::new(&testing_actors.fee_recipient, test_context).await,
        );
        balances.insert(
            TestingActorEnum::Relayer,
            Balance::new(&testing_actors.relayer, test_context).await,
        );
        for (index, solver) in testing_actors.solvers.iter().enumerate() {
            balances.insert(
                TestingActorEnum::Solver(index),
                Balance::new(&solver.actor, test_context).await,
            );
        }
        balances.insert(
            TestingActorEnum::Liquidator,
            Balance::new(&testing_actors.liquidator, test_context).await,
        );
        Self(balances)
    }
}

#[derive(Default, Debug, Clone)]
pub struct Balance {
    pub lamports: u64,
    pub usdc: u64,
    pub usdt: u64,
}

impl Balance {
    pub async fn new(testing_actor: &TestingActor, test_context: &mut ProgramTestContext) -> Self {
        Self {
            lamports: testing_actor.get_lamport_balance(test_context).await,
            usdc: testing_actor
                .get_token_account_balance(test_context, &SplTokenEnum::Usdc)
                .await,
            usdt: testing_actor
                .get_token_account_balance(test_context, &SplTokenEnum::Usdt)
                .await,
        }
    }
}

/// A struct containing all the testing actors (the owner, the owner assistant, the fee recipient, the relayer, solvers, liquidator)
pub struct TestingActors {
    pub payer_signer: Rc<Keypair>,
    pub owner: TestingActor,
    pub owner_assistant: TestingActor,
    pub fee_recipient: TestingActor,
    pub relayer: TestingActor,
    pub solvers: Vec<Solver>,
    pub liquidator: TestingActor,
}

impl std::fmt::Debug for TestingActors {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Create a string that lists all solvers with their indices
        let solver_string = {
            let solver_entries: Vec<String> = self
                .solvers
                .iter()
                .enumerate() // This gives (index, value) pairs
                .map(|(i, solver)| format!("solver {}: {}", i, solver.pubkey()))
                .collect();

            format!("[{}]", solver_entries.join(", "))
        };
        write!(
            f,
            "TestingActors {{ owner: {:?}, owner_assistant: {:?}, fee_recipient: {:?}, relayer: {:?}, solvers: {:?}, liquidator: {:?} }}",
            self.owner.pubkey(),
            self.owner_assistant.pubkey(),
            self.fee_recipient.pubkey(),
            self.relayer.pubkey(),
            solver_string,
            self.liquidator.pubkey(),
        )
    }
}

impl TestingActors {
    /// Create a new TestingActors struct
    ///
    /// # Arguments
    ///
    /// * `owner_keypair_path` - The path to the owner keypair
    ///
    /// # Returns
    pub fn new(owner_keypair_path: &str) -> Self {
        let owner_kp = Rc::new(read_keypair_from_file(owner_keypair_path));
        let owner = TestingActor::new(owner_kp.clone(), None, None);
        let owner_assistant = TestingActor::new(owner_kp.clone(), None, None);
        let fee_recipient = TestingActor::new(Rc::new(Keypair::new()), None, None);
        let relayer = TestingActor::new(Rc::new(Keypair::new()), None, None);
        let mut solvers = vec![];
        solvers.extend(vec![
            Solver::new(Rc::new(Keypair::new()), None, None),
            Solver::new(Rc::new(Keypair::new()), None, None),
            Solver::new(Rc::new(Keypair::new()), None, None),
        ]);
        let liquidator = TestingActor::new(Rc::new(Keypair::new()), None, None);
        Self {
            payer_signer: Rc::new(Keypair::new()),
            owner,
            owner_assistant,
            fee_recipient,
            relayer,
            solvers,
            liquidator,
        }
    }

    /// Get the actors that should have token accounts
    pub fn token_account_actors(&mut self) -> Vec<&mut TestingActor> {
        let mut actors = Vec::new();
        actors.push(&mut self.fee_recipient);
        actors.push(&mut self.owner);
        for solver in &mut self.solvers {
            actors.push(&mut solver.actor);
        }
        actors.push(&mut self.liquidator);
        actors
    }

    /// Transfer Lamports to Executors
    async fn airdrop_all(&self, test_context: &mut ProgramTestContext) {
        airdrop(test_context, &self.payer_signer.pubkey(), 10000000000).await;
        airdrop(test_context, &self.owner.pubkey(), 10000000000).await;
        airdrop(test_context, &self.owner_assistant.pubkey(), 10000000000).await;
        airdrop(test_context, &self.fee_recipient.pubkey(), 10000000000).await;
        airdrop(test_context, &self.relayer.pubkey(), 10000000000).await;
        for solver in self.solvers.iter() {
            airdrop(test_context, &solver.pubkey(), 10000000000).await;
        }
        airdrop(test_context, &self.liquidator.pubkey(), 10000000000).await;
    }

    /// Set up ATAs for Various Owners
    async fn create_usdc_atas(
        &mut self,
        test_context: &mut ProgramTestContext,
        usdc_mint_address: Pubkey,
    ) {
        for actor in self.token_account_actors() {
            let usdc_ata =
                create_token_account(test_context, &actor.keypair(), &usdc_mint_address).await;
            airdrop_spl_token(
                test_context,
                &usdc_ata.address,
                420_000__000_000,
                usdc_mint_address,
            )
            .await;
            actor.usdc_token_account = Some(usdc_ata);
        }
    }

    /// Create usdt associated token accounts
    pub async fn create_usdt_atas(
        &mut self,
        test_context: &mut ProgramTestContext,
        usdt_mint_address: Pubkey,
    ) {
        for actor in self.token_account_actors() {
            let usdt_ata =
                create_token_account(test_context, &actor.keypair(), &usdt_mint_address).await;
            airdrop_spl_token(
                test_context,
                &usdt_ata.address,
                420_000__000_000,
                usdt_mint_address,
            )
            .await;
            actor.usdt_token_account = Some(usdt_ata);
        }
    }

    pub fn get_actor(&self, actor_enum: &TestingActorEnum) -> &TestingActor {
        match actor_enum {
            TestingActorEnum::Owner => &self.owner,
            TestingActorEnum::OwnerAssistant => &self.owner_assistant,
            TestingActorEnum::FeeRecipient => &self.fee_recipient,
            TestingActorEnum::Relayer => &self.relayer,
            TestingActorEnum::Solver(index) => &self.solvers[*index].actor,
            TestingActorEnum::Liquidator => &self.liquidator,
        }
    }

    /// Add solvers to the testing actors
    #[allow(dead_code)]
    pub async fn add_solvers(
        &mut self,
        test_context: &mut ProgramTestContext,
        num_solvers: usize,
        usdc_mint_address: Pubkey,
        usdt_mint_address: Pubkey,
    ) {
        for _ in 0..num_solvers {
            let keypair = Rc::new(Keypair::new());
            let usdc_ata = create_token_account(test_context, &keypair, &usdc_mint_address).await;
            let usdt_ata = create_token_account(test_context, &keypair, &usdt_mint_address).await;
            airdrop(test_context, &keypair.pubkey(), 10000000000).await;
            self.solvers
                .push(Solver::new(keypair.clone(), Some(usdc_ata), Some(usdt_ata)));
        }
    }
}

/// The mode of the shim
///
/// # Enums
///
/// * `None` - No shims
/// * `PostVaa` - Post the VAAs but don't add the shims
/// * `VerifySignature` - Only add the verify signature shim program
/// * `VerifyAndPostSignature` - Add the verify signature and post message shims program
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ShimMode {
    None,
    VerifySignature,
    VerifyAndPostSignature,
}

/// The direction of the transfer
///
/// # Enums
///
/// * `FromArbitrumToEthereum` - The direction of the transfer from Arbitrum to Ethereum
/// * `FromEthereumToArbitrum` - The direction of the transfer from Ethereum to Arbitrum
/// * `Other` - The direction of the transfer is not supported
#[allow(dead_code)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum TransferDirection {
    FromArbitrumToEthereum,
    FromEthereumToArbitrum,
    Other, // TODO: Add other transfer directions
}

impl Default for TransferDirection {
    fn default() -> Self {
        Self::FromArbitrumToEthereum
    }
}

/// Setup the environment for the tests
///
/// This function first creates a PreTestingContext struct, which allows setting up the program test context, and load in accounts before starting the test context.
/// Then it starts the test context and returns a TestingContext struct.
///
/// # Arguments
///
/// * `shim_mode` - The mode of the shim
/// * `transfer_direction` - The direction of the transfer
/// * `vaa_args` - The arguments for the VAA
///
/// # Returns
///
/// A TestingContext struct containing the testing actors, test context, loaded fixture accounts,
/// and testing state (which includes the auction state and the VAAs)
pub async fn setup_environment(
    shim_mode: ShimMode,
    transfer_direction: TransferDirection,
    vaa_args: Option<Vec<VaaArgs>>,
) -> (TestingContext, ProgramTestContext) {
    let mut pre_testing_context = PreTestingContext::new(PROGRAM_ID, OWNER_KEYPAIR_PATH);
    let vaas_test: Option<TestVaaPairs> = match vaa_args {
        Some(vaa_args_plural) => {
            let mut vaas_test_temp = TestVaaPairs::new();
            for vaa_args in vaa_args_plural {
                let arbitrum_emitter_address: [u8; 32] = REGISTERED_TOKEN_ROUTERS[&Chain::Arbitrum]
                    .clone()
                    .try_into()
                    .expect("Failed to convert registered token router address to bytes [u8; 32]");
                let ethereum_emitter_address: [u8; 32] = REGISTERED_TOKEN_ROUTERS[&Chain::Ethereum]
                    .clone()
                    .try_into()
                    .expect("Failed to convert registered token router address to bytes [u8; 32]");
                let new_vaas_test = match transfer_direction {
                    TransferDirection::FromArbitrumToEthereum => {
                        create_vaas_test_with_chain_and_address(
                            &mut pre_testing_context.program_test,
                            USDC_MINT_ADDRESS,
                            CCTP_MINT_RECIPIENT,
                            ChainAndAddress {
                                chain: Chain::Arbitrum,
                                address: arbitrum_emitter_address,
                            },
                            ChainAndAddress {
                                chain: Chain::Ethereum,
                                address: ethereum_emitter_address,
                            },
                            vaa_args,
                        )
                    }
                    TransferDirection::FromEthereumToArbitrum => {
                        create_vaas_test_with_chain_and_address(
                            &mut pre_testing_context.program_test,
                            USDC_MINT_ADDRESS,
                            CCTP_MINT_RECIPIENT,
                            ChainAndAddress {
                                chain: Chain::Ethereum,
                                address: ethereum_emitter_address,
                            },
                            ChainAndAddress {
                                chain: Chain::Arbitrum,
                                address: arbitrum_emitter_address,
                            },
                            vaa_args,
                        )
                    }
                    TransferDirection::Other => panic!("Unsupported transfer direction"),
                };
                vaas_test_temp.extend(new_vaas_test.0);
            }
            Some(vaas_test_temp)
        }
        None => None,
    };
    match shim_mode {
        ShimMode::None => {}
        ShimMode::VerifySignature => {
            pre_testing_context.add_verify_shims();
        }
        ShimMode::VerifyAndPostSignature => {
            pre_testing_context.add_verify_shims();
            pre_testing_context.add_post_message_shims();
        }
    };
    TestingContext::new(
        pre_testing_context,
        transfer_direction,
        vaas_test,
        shim_mode,
    )
    .await
}
