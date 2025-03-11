use anchor_lang::AccountDeserialize;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    pubkey::Pubkey, signature::{Keypair, Signer}, transaction::Transaction,
};
use std::rc::Rc;
use std::cell::RefCell;
use anchor_spl::token::{spl_token::{self, instruction::approve}, TokenAccount};
use super::{airdrop::airdrop_usdc, token_account::{create_token_account, read_keypair_from_file, TokenAccountFixture}};
use super::mint::MintFixture;
use super::program_fixtures::{initialise_upgrade_manager, initialise_cctp_token_messenger_minter, initialise_wormhole_core_bridge, initialise_cctp_message_transmitter, initialise_local_token_router, initialise_post_message_shims, initialise_verify_shims};
use super::airdrop::airdrop;
use super::account_fixtures::FixtureAccounts;

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
            "matching_engine",  // Replace with your program name
            program_id,
            None,
        );
        program_test.set_compute_max_units(1000000000);
        program_test.set_transaction_account_lock_limit(1000);
        

        // Setup Testing Actors
        let testing_actors = TestingActors::new(owner_keypair_path);

        // Initialise Upgrade Manager
        let program_data_pubkey = initialise_upgrade_manager(&mut program_test, &program_id, testing_actors.owner.pubkey());

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

    pub fn add_post_message_shims(&mut self) {
        initialise_post_message_shims(&mut self.program_test);
    }

    pub fn add_verify_shims(&mut self) {
        initialise_verify_shims(&mut self.program_test);
    }
}


pub struct TestingContext {
    pub program_data_account: Pubkey, // Move this into something smarter
    pub testing_actors: TestingActors,
    pub test_context: Rc<RefCell<ProgramTestContext>>,
    pub fixture_accounts: Option<FixtureAccounts>,
}

impl TestingContext {
    pub async fn new(mut pre_testing_context: PreTestingContext, usdc_mint_fixture_path: &str, usdc_mint_address: Pubkey) -> Self {
        let test_context = Rc::new(RefCell::new(pre_testing_context.program_test.start_with_context().await));
    
        // Airdrop to all actors
        pre_testing_context.testing_actors.airdrop_all(&test_context).await;

        // Create USDC mint
        let _mint_fixture = MintFixture::new_from_file(&test_context, usdc_mint_fixture_path);

        // Create USDC ATAs for all actors that need them
        pre_testing_context.testing_actors.create_atas(&test_context, usdc_mint_address).await;

        TestingContext { program_data_account: pre_testing_context.program_data_pubkey, testing_actors: pre_testing_context.testing_actors, test_context, fixture_accounts: Some(pre_testing_context.account_fixtures) }
    }
}

#[derive(Clone)]
pub struct Solver {
    pub actor: TestingActor,
}

impl Solver {
    pub fn new(keypair: Rc<Keypair>, token_account: Option<TokenAccountFixture>) -> Self {
        Self { actor: TestingActor::new(keypair, token_account) }
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

    pub async fn approve_usdc(&self, test_context: &Rc<RefCell<ProgramTestContext>>, delegate: &Pubkey, amount: u64) {
        // If signer pubkeys are empty, it means that the owner is the signer
        let last_blockhash = test_context.borrow_mut().get_new_latest_blockhash().await.expect("Failed to get new blockhash");
        let approve_ix = approve(&spl_token::ID, &self.token_account_address().unwrap(), delegate, &self.actor.pubkey(), &[], amount).expect("Failed to create approve USDC instruction");
        let transaction = Transaction::new_signed_with_payer(
            &[approve_ix],
            Some(&self.actor.pubkey()),
            &[&self.actor.keypair()],
            last_blockhash,
        );
        
        test_context.borrow_mut().banks_client.process_transaction(transaction).await.expect("Failed to approve USDC");
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

    pub async fn get_balance(&self, test_context: &Rc<RefCell<ProgramTestContext>>) -> u64 {
        if let Some(token_account) = self.token_account_address() {
            let account = test_context.borrow_mut().banks_client.get_account(token_account).await.unwrap().unwrap();
            let token_account = TokenAccount::try_deserialize(&mut &account.data[..]).unwrap();
            token_account.amount
        }
        else {
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
    async fn create_atas(&mut self, test_context: &Rc<RefCell<ProgramTestContext>>, usdc_mint_address: Pubkey) {
        for actor in self.token_account_actors() {
            let usdc_ata = create_token_account(test_context.clone(), &actor.keypair(), &usdc_mint_address).await;
            airdrop_usdc(test_context, &usdc_ata.address, 420_000__000_000).await;
            actor.token_account = Some(usdc_ata);
        }
    }

    /// Add solvers to the testing actors
    #[allow(dead_code)]
    async fn add_solvers(&mut self, test_context: &Rc<RefCell<ProgramTestContext>>, num_solvers: usize, usdc_mint_address: Pubkey) {
        for _ in 0..num_solvers {
            let keypair = Rc::new(Keypair::new());
            let usdc_ata = create_token_account(test_context.clone(), &keypair, &usdc_mint_address).await;
            airdrop(test_context, &keypair.pubkey(), 10000000000).await;
            self.solvers.push(Solver::new(keypair.clone(), Some(usdc_ata)));
        }
    }
}

pub async fn fast_forward_slots(test_context: &Rc<RefCell<ProgramTestContext>>, num_slots: u64) {
    // Get the current slot
    let mut current_slot = test_context
        .borrow_mut()
        .banks_client
        .get_root_slot()
        .await
        .unwrap();

    let target_slot = current_slot + num_slots;
    while current_slot < target_slot {
        // Warp to the next slot - note we need to borrow_mut() here
        test_context
            .borrow_mut()
            .warp_to_slot(current_slot + 1)
            .expect("Failed to warp to slot");
        current_slot += 1;
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
}