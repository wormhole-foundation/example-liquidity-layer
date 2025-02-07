use solana_program_test::{ProgramTest, ProgramTestContext, tokio};
use solana_sdk::{
    pubkey::Pubkey, signature::{Keypair, Signer},
};
use std::rc::Rc;
use std::cell::RefCell;

mod utils;
use utils::{router::add_local_router_endpoint_ix, token_account::{create_token_account, read_keypair_from_file, TokenAccountFixture}, Chain};
use utils::mint::MintFixture;
use utils::program_fixtures::{initialise_upgrade_manager, initialise_cctp_token_messenger_minter, initialise_wormhole_core_bridge, initialise_cctp_message_transmitter, initialise_local_token_router};
use utils::airdrop::airdrop;
use utils::initialize::initialize_program;
use utils::account_fixtures::FixtureAccounts;
use utils::router::add_cctp_router_endpoint_ix;
use utils::vaa::create_vaas_test;
// Configures the program ID and CCTP mint recipient based on the environment
cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("5BsCKkzuZXLygduw6RorCqEB61AdzNkxp5VzQrFGzYWr");
        const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("HUXc7MBf55vWrrkevVbmJN8HAyfFtjLcPLBt9yWngKzm");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint.json";
    } else if #[cfg(feature = "testnet")] {
        const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS");
        const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("6yKmqWarCry3c8ntYKzM4WiS2fVypxLbENE2fP8onJje");
        const USDC_MINT_ADDRESS: Pubkey = solana_sdk::pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
        const USDC_MINT_FIXTURE_PATH: &str = "tests/fixtures/usdc_mint_devnet.json";
    } else if #[cfg(feature = "localnet")] {
        const PROGRAM_ID : Pubkey = solana_sdk::pubkey!("MatchingEngine11111111111111111111111111111");
        const CCTP_MINT_RECIPIENT: Pubkey = solana_sdk::pubkey!("35iwWKi7ebFyXNaqpswd1g9e9jrjvqWPV39nCQPaBbX1");
    }
}
const OWNER_KEYPAIR_PATH: &str = "tests/keys/pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ.json";

pub struct Solver {
    pub actor: TestingActor,
    pub endpoint: Option<String>,
}

impl Solver {
    pub fn new(keypair: Rc<Keypair>, token_account: Option<TokenAccountFixture>, endpoint: Option<String>) -> Self {
        Self { actor: TestingActor::new(keypair, token_account), endpoint }
    }

    pub fn get_endpoint(&self) -> Option<String> {
        self.endpoint.clone()
    }   
    
    pub fn keypair(&self) -> Rc<Keypair> {
        self.actor.keypair.clone()
    }

    pub fn pubkey(&self) -> Pubkey {
        self.actor.keypair.pubkey()
    }
}

pub struct TestingActor {
    pub keypair: Rc<Keypair>,
    pub token_account: Option<TokenAccountFixture>,
}

impl std::fmt::Debug for TestingActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TestingActor {{ pubkey: {:?}, token_account: {:?} }}", self.keypair.pubkey(), self.token_account)
    }
}

impl TestingActor {
    pub fn new(keypair: Rc<Keypair>, token_account: Option<TokenAccountFixture>) -> Self {
        Self { keypair, token_account }
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
    pub fn new() -> Self {
        let owner_kp = Rc::new(read_keypair_from_file(OWNER_KEYPAIR_PATH));
        let owner = TestingActor::new(owner_kp.clone(), None);
        let owner_assistant = TestingActor::new(owner_kp.clone(), None);
        let fee_recipient = TestingActor::new(Rc::new(Keypair::new()), None);
        let relayer = TestingActor::new(Rc::new(Keypair::new()), None);
        // TODO: Change player 1 solver to use the keyfile
        let mut solvers = vec![];
        solvers.extend(vec![
            Solver::new(Rc::new(Keypair::new()), None, None),
            Solver::new(Rc::new(Keypair::new()), None, None),
            Solver::new(Rc::new(Keypair::new()), None, None),
        ]);
        let liquidator = TestingActor::new(Rc::new(Keypair::new()), None);
        Self { owner, owner_assistant, fee_recipient, relayer, solvers, liquidator }
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
    async fn create_atas(&mut self, test_context: &Rc<RefCell<ProgramTestContext>>) {
        for actor in self.token_account_actors() {
            let usdc_ata = create_token_account(test_context.clone(), &actor.keypair(), &USDC_MINT_ADDRESS).await;
            actor.token_account = Some(usdc_ata);
        }
    }

    /// Add solvers to the testing actors
    #[allow(dead_code)]
    async fn add_solvers(&mut self, test_context: &Rc<RefCell<ProgramTestContext>>, num_solvers: usize) {
        for _ in 0..num_solvers {
            let keypair = Rc::new(Keypair::new());
            let usdc_ata = create_token_account(test_context.clone(), &keypair, &USDC_MINT_ADDRESS).await;
            airdrop(test_context, &keypair.pubkey(), 10000000000).await;
            self.solvers.push(Solver::new(keypair.clone(), Some(usdc_ata), None));
        }
    }
}

pub struct TestingContext {
    pub program_data_account: Pubkey, // Move this into something smarter
    pub testing_actors: TestingActors,
    pub test_context: Rc<RefCell<ProgramTestContext>>,
    pub fixture_accounts: Option<FixtureAccounts>,
}

pub struct PreTestingContext {
    pub program_test: ProgramTest,
    pub testing_actors: TestingActors,
    pub program_data_pubkey: Pubkey,
    pub account_fixtures: FixtureAccounts,
}

/// Setup the test context
///
/// # Returns
///
/// A TestingContext struct containing the program data account, testing actors, test context, and fixture accounts
fn setup_program_test() -> PreTestingContext {
    let mut program_test = ProgramTest::new(
        "matching_engine",  // Replace with your program name
        PROGRAM_ID,
        None,
    );
    program_test.set_compute_max_units(1000000000);
    program_test.set_transaction_account_lock_limit(1000);

    // Setup Testing Actors
    let testing_actors = TestingActors::new();

    // Initialise Upgrade Manager
    let program_data_pubkey = initialise_upgrade_manager(&mut program_test, &PROGRAM_ID, testing_actors.owner.pubkey());

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

    PreTestingContext { program_test, testing_actors, program_data_pubkey, account_fixtures }
}

async fn setup_testing_context(mut pre_testing_context: PreTestingContext) -> TestingContext {
    // Start and get test context
    let test_context = Rc::new(RefCell::new(pre_testing_context.program_test.start_with_context().await));
    
    // Airdrop to all actors
    pre_testing_context.testing_actors.airdrop_all(&test_context).await;

    // Create USDC mint
    let _mint_fixture = MintFixture::new_from_file(&test_context, USDC_MINT_FIXTURE_PATH);

    // Create USDC ATAs for all actors that need them
    pre_testing_context.testing_actors.create_atas(&test_context).await;

    TestingContext { program_data_account: pre_testing_context.program_data_pubkey, testing_actors: pre_testing_context.testing_actors, test_context, fixture_accounts: Some(pre_testing_context.account_fixtures) }
}

/// Test that the program is initialised correctly
#[tokio::test]
pub async fn test_initialize_program() {
    
    let pre_testing_context = setup_program_test();
    let testing_context = setup_testing_context(pre_testing_context).await;

    let initialize_fixture = initialize_program(&testing_context, PROGRAM_ID, USDC_MINT_ADDRESS, CCTP_MINT_RECIPIENT).await;

    // Check that custodian data corresponds to the expected values
    initialize_fixture.verify_custodian(testing_context.testing_actors.owner.pubkey(), testing_context.testing_actors.owner_assistant.pubkey(), testing_context.testing_actors.fee_recipient.token_account.unwrap().address);
}

/// Test that a CCTP token router endpoint is created for the arbitrum and ethereum chains
#[tokio::test]
pub async fn test_cctp_token_router_endpoint_creation() {
    let pre_testing_context = setup_program_test();
    let testing_context = setup_testing_context(pre_testing_context).await;

    let initialize_fixture = initialize_program(&testing_context, PROGRAM_ID, USDC_MINT_ADDRESS, CCTP_MINT_RECIPIENT).await;

    // Create a token router endpoint for the arbitrum chain
    let arb_chain = Chain::Arbitrum;
    
    let fixture_accounts = testing_context.fixture_accounts.expect("Pre-made fixture accounts not found");
    let arb_remote_token_messenger = fixture_accounts.arbitrum_remote_token_messenger;

    let usdc_mint_address = USDC_MINT_ADDRESS;
    
    let arbitrum_token_router_endpoint = add_cctp_router_endpoint_ix(
        &testing_context.test_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.custodian_address,
        testing_context.testing_actors.owner.keypair().as_ref(),
        PROGRAM_ID,
        arb_remote_token_messenger,
        usdc_mint_address,
        arb_chain,
    ).await;
    assert_eq!(arbitrum_token_router_endpoint.info.chain, arb_chain.to_chain_id());

    // Create a token router endpoint for the ethereum chain
    let eth_chain = Chain::Ethereum;
    let eth_remote_token_messenger = fixture_accounts.ethereum_remote_token_messenger;

    let _eth_token_router_endpoint = add_cctp_router_endpoint_ix(
        &testing_context.test_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.custodian_address,
        testing_context.testing_actors.owner.keypair().as_ref(),
        PROGRAM_ID,
        eth_remote_token_messenger,
        usdc_mint_address,
        eth_chain,
    ).await;
}

#[tokio::test]
pub async fn test_local_token_router_endpoint_creation() {
    let pre_testing_context = setup_program_test();
    let testing_context = setup_testing_context(pre_testing_context).await;

    let initialize_fixture: utils::initialize::InitializeFixture = initialize_program(&testing_context, PROGRAM_ID, USDC_MINT_ADDRESS, CCTP_MINT_RECIPIENT).await;
    let _fixture_accounts: FixtureAccounts = testing_context.fixture_accounts.expect("Pre-made fixture accounts not found");

    let usdc_mint_address = USDC_MINT_ADDRESS;

    let _local_token_router_endpoint = add_local_router_endpoint_ix(
        &testing_context.test_context,
        testing_context.testing_actors.owner.pubkey(),
        initialize_fixture.custodian_address,
        testing_context.testing_actors.owner.keypair().as_ref(),
        PROGRAM_ID,
        &usdc_mint_address,
    ).await;
}

// Test setting up vaas
// - The payload of the vaa should be the .to_vec() of the FastMarketOrder under universal/rs/messages/src/fast_market_order.rs
#[tokio::test]
pub async fn test_setup_vaas() {
    let mut pre_testing_context = setup_program_test();
    let vaas_test = create_vaas_test(&mut pre_testing_context.program_test, USDC_MINT_ADDRESS, None, CCTP_MINT_RECIPIENT);
    let testing_context = setup_testing_context(pre_testing_context).await;
    let _initialize_fixture = initialize_program(&testing_context, PROGRAM_ID, USDC_MINT_ADDRESS, CCTP_MINT_RECIPIENT).await;
    vaas_test.0.first().unwrap().verify_vaas(&testing_context.test_context).await;

    // Try making initial offer
}
