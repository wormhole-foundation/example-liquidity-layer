use super::account_fixtures::FixtureAccounts;
use super::airdrop::airdrop;
use super::auction::AuctionState;
use super::mint::MintFixture;
use super::program_fixtures::{
    initialise_cctp_message_transmitter, initialise_cctp_token_messenger_minter,
    initialise_local_token_router, initialise_post_message_shims, initialise_upgrade_manager,
    initialise_verify_shims, initialise_wormhole_core_bridge,
};
use super::vaa::{
    create_vaas_test_with_chain_and_address, ChainAndAddress, TestVaaPair, TestVaaPairs, VaaArgs,
};
use super::{
    airdrop::airdrop_usdc,
    token_account::{create_token_account, read_keypair_from_file, TokenAccountFixture},
};
use super::{Chain, REGISTERED_TOKEN_ROUTERS};
use crate::testing_engine::config::{ExpectedError, ExpectedLog};
use anchor_lang::AccountDeserialize;
use anchor_spl::token::{
    spl_token::{self, instruction::approve},
    TokenAccount,
};
use anyhow::Result as AnyhowResult;
use matching_engine::{CCTP_MINT_RECIPIENT, ID as PROGRAM_ID};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::instruction::InstructionError;
use solana_sdk::transaction::{TransactionError, VersionedTransaction};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::cell::RefCell;
use std::rc::Rc;

// Configures the program ID and CCTP mint recipient based on the environment
cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        //const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("5BsCKkzuZXLygduw6RorCqEB61AdzNkxp5VzQrFGzYWr");
        //const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("HUXc7MBf55vWrrkevVbmJN8HAyfFtjLcPLBt9yWngKzm");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint.json";
    } else if #[cfg(feature = "testnet")] {
        //const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS");
        //const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("6yKmqWarCry3c8ntYKzM4WiS2fVypxLbENE2fP8onJje");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint_devnet.json";
    } else if #[cfg(feature = "localnet")] {
        //const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("MatchingEngine11111111111111111111111111111");
        // const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("35iwWKi7ebFyXNaqpswd1g9e9jrjvqWPV39nCQPaBbX1");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint_devnet.json";
    }
}
const OWNER_KEYPAIR_PATH: &str = "tests/keys/pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ.json";

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

    pub fn add_post_message_shims(&mut self) {
        initialise_post_message_shims(&mut self.program_test);
    }

    pub fn add_verify_shims(&mut self) {
        initialise_verify_shims(&mut self.program_test);
    }
}

pub struct TestingContext {
    pub program_data_account: Pubkey, // TODO: Move this into something smarter
    pub testing_actors: TestingActors,
    pub test_context: Rc<RefCell<ProgramTestContext>>,
    pub fixture_accounts: Option<FixtureAccounts>,
    pub testing_state: TestingState,
}

impl TestingContext {
    pub async fn new(
        mut pre_testing_context: PreTestingContext,
        transfer_direction: TransferDirection,
        vaas_test: Option<TestVaaPairs>,
    ) -> Self {
        let test_context = Rc::new(RefCell::new(
            pre_testing_context.program_test.start_with_context().await,
        ));

        // Airdrop to all actors
        pre_testing_context
            .testing_actors
            .airdrop_all(&test_context)
            .await;

        // Create USDC mint
        let _mint_fixture = MintFixture::new_from_file(&test_context, USDC_MINT_FIXTURE_PATH);

        // Create USDC ATAs for all actors that need them
        pre_testing_context
            .testing_actors
            .create_atas(&test_context, USDC_MINT_ADDRESS)
            .await;
        let testing_state = match vaas_test {
            Some(vaas_test) => TestingState {
                vaas: vaas_test,
                transfer_direction,
                ..TestingState::default()
            },
            None => TestingState {
                transfer_direction,
                ..TestingState::default()
            },
        };
        TestingContext {
            program_data_account: pre_testing_context.program_data_pubkey,
            testing_actors: pre_testing_context.testing_actors,
            test_context,
            fixture_accounts: Some(pre_testing_context.account_fixtures),
            testing_state,
        }
    }

    pub async fn verify_vaas(&self) {
        self.testing_state.vaas.verify_posted_vaas(self).await;
    }

    pub fn get_vaa_pair(&self, index: usize) -> Option<TestVaaPair> {
        if index < self.testing_state.vaas.len() {
            Some(self.testing_state.vaas[index].clone())
        } else {
            None
        }
    }

    pub fn get_fixture_accounts(&self) -> Option<FixtureAccounts> {
        self.fixture_accounts.clone()
    }

    pub fn get_matching_engine_program_id(&self) -> Pubkey {
        PROGRAM_ID
    }

    pub fn get_usdc_mint_address(&self) -> Pubkey {
        USDC_MINT_ADDRESS
    }

    pub fn get_cctp_mint_recipient(&self) -> Pubkey {
        CCTP_MINT_RECIPIENT
    }

    pub fn get_wormhole_program_id(&self) -> Pubkey {
        wormhole_svm_definitions::solana::CORE_BRIDGE_PROGRAM_ID
    }

    pub async fn get_new_latest_blockhash(&self) -> AnyhowResult<solana_program::hash::Hash> {
        let mut ctx = self.test_context.borrow_mut();
        let handle = ctx.get_new_latest_blockhash();
        let hash = handle.await?;
        Ok(hash)
    }

    pub async fn process_transaction(
        &self,
        transaction: impl Into<VersionedTransaction>,
    ) -> Result<(), BanksClientError> {
        let mut ctx = self.test_context.borrow_mut();
        let handle = ctx.banks_client.process_transaction(transaction);
        handle.await
    }

    pub async fn get_account(
        &self,
        address: Pubkey,
    ) -> Result<Option<solana_sdk::account::Account>, BanksClientError> {
        let mut ctx = self.test_context.borrow_mut();
        let account = ctx.banks_client.get_account(address).await?;
        drop(ctx);
        Ok(account)
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
    #[allow(dead_code)]
    pub async fn simulate_and_verify_logs(
        &self,
        transaction: impl Into<VersionedTransaction>,
        expected_logs: Vec<ExpectedLog>,
    ) -> AnyhowResult<()> {
        let mut ctx = self.test_context.borrow_mut();
        let simulation_result = ctx.banks_client.simulate_transaction(transaction).await?;
        drop(ctx);

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

    // TODO: Edit to handle multiple instructions in a single transaction
    pub async fn execute_and_verify_transaction(
        &self,
        transaction: impl Into<VersionedTransaction>,
        expected_error: Option<&ExpectedError>,
    ) {
        let tx_result = self.process_transaction(transaction).await;
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
}

#[derive(Clone)]
pub struct Solver {
    pub actor: TestingActor,
}

impl Solver {
    pub fn new(keypair: Rc<Keypair>, token_account: Option<TokenAccountFixture>) -> Self {
        Self {
            actor: TestingActor::new(keypair, token_account),
        }
    }

    pub fn keypair(&self) -> Rc<Keypair> {
        self.actor.keypair.clone()
    }

    pub fn pubkey(&self) -> Pubkey {
        self.actor.keypair.pubkey()
    }

    pub fn token_account_address(&self) -> Option<Pubkey> {
        self.actor.token_account.as_ref().map(|t| t.address)
    }

    pub async fn approve_usdc(
        &self,
        test_context: &Rc<RefCell<ProgramTestContext>>,
        delegate: &Pubkey,
        amount: u64,
    ) {
        // If signer pubkeys are empty, it means that the owner is the signer
        let mut ctx = test_context.borrow_mut();
        let last_blockhash = ctx
            .get_new_latest_blockhash()
            .await
            .expect("Failed to get new blockhash");
        drop(ctx);
        let approve_ix = approve(
            &spl_token::ID,
            &self.token_account_address().unwrap(),
            delegate,
            &self.actor.pubkey(),
            &[],
            amount,
        )
        .expect("Failed to create approve USDC instruction");
        let transaction = Transaction::new_signed_with_payer(
            &[approve_ix],
            Some(&self.actor.pubkey()),
            &[&self.actor.keypair()],
            last_blockhash,
        );
        let mut ctx = test_context.borrow_mut();
        ctx.banks_client
            .process_transaction(transaction)
            .await
            .expect("Failed to approve USDC");
        drop(ctx);
    }

    pub async fn get_balance(&self, test_context: &Rc<RefCell<ProgramTestContext>>) -> u64 {
        self.actor.get_balance(test_context).await
    }
}

#[derive(Clone)]
pub struct TestingActor {
    pub keypair: Rc<Keypair>,
    pub token_account: Option<TokenAccountFixture>,
}

impl std::fmt::Debug for TestingActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "TestingActor {{ pubkey: {:?}, token_account: {:?} }}",
            self.keypair.pubkey(),
            self.token_account
        )
    }
}

impl TestingActor {
    pub fn new(keypair: Rc<Keypair>, token_account: Option<TokenAccountFixture>) -> Self {
        Self {
            keypair,
            token_account,
        }
    }
    pub fn pubkey(&self) -> Pubkey {
        self.keypair.pubkey()
    }
    pub fn keypair(&self) -> Rc<Keypair> {
        self.keypair.clone()
    }

    pub fn token_account_address(&self) -> Option<Pubkey> {
        self.token_account.as_ref().map(|t| t.address)
    }

    pub async fn get_balance(&self, test_context: &Rc<RefCell<ProgramTestContext>>) -> u64 {
        if let Some(token_account) = self.token_account_address() {
            let account = test_context
                .borrow_mut()
                .banks_client
                .get_account(token_account)
                .await
                .unwrap()
                .unwrap();
            let token_account = TokenAccount::try_deserialize(&mut &account.data[..]).unwrap();
            token_account.amount
        } else {
            0
        }
    }
}

/// A struct containing all the testing actors (the owner, the owner assistant, the fee recipient, the relayer, solvers, liquidator)
pub struct TestingActors {
    pub owner: TestingActor,
    pub owner_assistant: TestingActor,
    pub fee_recipient: TestingActor,
    pub relayer: TestingActor,
    pub solvers: Vec<Solver>,
    pub liquidator: TestingActor,
}

impl TestingActors {
    pub fn new(owner_keypair_path: &str) -> Self {
        let owner_kp = Rc::new(read_keypair_from_file(owner_keypair_path));
        let owner = TestingActor::new(owner_kp.clone(), None);
        let owner_assistant = TestingActor::new(owner_kp.clone(), None);
        let fee_recipient = TestingActor::new(Rc::new(Keypair::new()), None);
        let relayer = TestingActor::new(Rc::new(Keypair::new()), None);
        // TODO: Change player 1 solver to use the keyfile
        let mut solvers = vec![];
        solvers.extend(vec![
            Solver::new(Rc::new(Keypair::new()), None),
            Solver::new(Rc::new(Keypair::new()), None),
            Solver::new(Rc::new(Keypair::new()), None),
        ]);
        let liquidator = TestingActor::new(Rc::new(Keypair::new()), None);
        Self {
            owner,
            owner_assistant,
            fee_recipient,
            relayer,
            solvers,
            liquidator,
        }
    }

    pub fn token_account_actors(&mut self) -> Vec<&mut TestingActor> {
        let mut actors = Vec::new();
        actors.push(&mut self.fee_recipient);
        for solver in &mut self.solvers {
            actors.push(&mut solver.actor);
        }
        actors.push(&mut self.liquidator);
        actors
    }

    /// Transfer Lamports to Executors
    async fn airdrop_all(&self, test_context: &Rc<RefCell<ProgramTestContext>>) {
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
    async fn create_atas(
        &mut self,
        test_context: &Rc<RefCell<ProgramTestContext>>,
        usdc_mint_address: Pubkey,
    ) {
        for actor in self.token_account_actors() {
            let usdc_ata =
                create_token_account(test_context.clone(), &actor.keypair(), &usdc_mint_address)
                    .await;
            airdrop_usdc(test_context, &usdc_ata.address, 420_000__000_000).await;
            actor.token_account = Some(usdc_ata);
        }
    }

    /// Add solvers to the testing actors
    #[allow(dead_code)]
    async fn add_solvers(
        &mut self,
        test_context: &Rc<RefCell<ProgramTestContext>>,
        num_solvers: usize,
        usdc_mint_address: Pubkey,
    ) {
        for _ in 0..num_solvers {
            let keypair = Rc::new(Keypair::new());
            let usdc_ata =
                create_token_account(test_context.clone(), &keypair, &usdc_mint_address).await;
            airdrop(test_context, &keypair.pubkey(), 10000000000).await;
            self.solvers
                .push(Solver::new(keypair.clone(), Some(usdc_ata)));
        }
    }
}

pub async fn fast_forward_slots(testing_context: &TestingContext, num_slots: u64) {
    // Get the current slot
    let mut current_slot = testing_context
        .test_context
        .borrow_mut()
        .banks_client
        .get_root_slot()
        .await
        .unwrap();

    let test_context = &testing_context.test_context;

    let target_slot = current_slot.saturating_add(num_slots);
    while current_slot < target_slot {
        // Warp to the next slot - note we need to borrow_mut() here
        test_context
            .borrow_mut()
            .warp_to_slot(current_slot.saturating_add(1))
            .expect("Failed to warp to slot");
        current_slot = current_slot.saturating_add(1);
    }

    // Optionally, process a transaction to ensure the new slot is recognized
    let recent_blockhash = test_context.borrow().last_blockhash;
    let payer = test_context.borrow().payer.pubkey();
    let tx = Transaction::new_signed_with_payer(
        &[],
        Some(&payer),
        &[&test_context.borrow().payer],
        recent_blockhash,
    );

    test_context
        .borrow_mut()
        .banks_client
        .process_transaction(tx)
        .await
        .expect("Failed to process transaction after warping");

    println!("Fast forwarded {} slots", num_slots);
}

#[derive(Clone)]
pub struct ProgramAddresses {
    pub custodian_address: Pubkey,
}

pub struct TestingState {
    pub auction_state: AuctionState,
    pub vaas: TestVaaPairs,
    pub transfer_direction: TransferDirection,
}

impl Default for TestingState {
    fn default() -> Self {
        Self {
            auction_state: AuctionState::Inactive,
            vaas: TestVaaPairs::new(),
            transfer_direction: TransferDirection::FromEthereumToArbitrum,
        }
    }
}

pub enum ShimMode {
    None,
    PostVaa,
    // VerifySignature,
    VerifyAndPostSignature,
}

#[allow(dead_code)]
#[derive(Copy, Clone)]
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
    vaa_args: Option<VaaArgs>,
) -> TestingContext {
    let mut pre_testing_context = PreTestingContext::new(PROGRAM_ID, OWNER_KEYPAIR_PATH);
    let vaas_test: Option<TestVaaPairs> = match vaa_args {
        Some(vaa_args) => {
            let arbitrum_emitter_address: [u8; 32] = REGISTERED_TOKEN_ROUTERS[&Chain::Arbitrum]
                .clone()
                .try_into()
                .expect("Failed to convert registered token router address to bytes [u8; 32]");
            let ethereum_emitter_address: [u8; 32] = REGISTERED_TOKEN_ROUTERS[&Chain::Ethereum]
                .clone()
                .try_into()
                .expect("Failed to convert registered token router address to bytes [u8; 32]");
            match transfer_direction {
                TransferDirection::FromArbitrumToEthereum => {
                    Some(create_vaas_test_with_chain_and_address(
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
                    ))
                }
                TransferDirection::FromEthereumToArbitrum => {
                    Some(create_vaas_test_with_chain_and_address(
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
                    ))
                }
                TransferDirection::Other => panic!("Unsupported transfer direction"),
            }
        }
        None => None,
    };
    match shim_mode {
        ShimMode::None => {}
        ShimMode::PostVaa => {}
        // ShimMode::VerifySignature => {
        //     pre_testing_context.add_verify_shims();
        // }
        ShimMode::VerifyAndPostSignature => {
            pre_testing_context.add_verify_shims();
            pre_testing_context.add_post_message_shims();
        }
    };
    TestingContext::new(pre_testing_context, transfer_direction, vaas_test).await
}
