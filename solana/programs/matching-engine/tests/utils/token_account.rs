use solana_sdk::{program_pack::Pack, transaction::Transaction, pubkey::Pubkey, signature::Keypair, signer::Signer};
use anchor_spl::token::spl_token;
use anchor_spl::associated_token::spl_associated_token_account;
use solana_program_test::{ProgramTest, ProgramTestContext};
use serde_json::Value;
use std::{cell::RefCell, fs, rc::Rc, str::FromStr};


pub struct TokenAccountFixture {
    pub test_ctx: Rc<RefCell<ProgramTestContext>>,
    pub address: Pubkey,
    pub account: spl_token::state::Account,
}

impl std::fmt::Debug for TokenAccountFixture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TokenAccountFixture {{ address: {}, account: {:?} }}", self.address, self.account)
    }
}

/// Creates a token account for the given owner and mint
///
/// # Arguments
///
/// * `program_test` - The program test instance
/// * `payer` - The payer of the account
/// * `owner` - The owner of the account
/// * `mint` - The mint of the account
pub async fn create_token_account(
    test_ctx: Rc<RefCell<ProgramTestContext>>,
    owner: &Keypair,
    mint: &Pubkey,
) -> TokenAccountFixture {

    let test_ctx_ref = Rc::clone(&test_ctx);

    // Derive the Associated Token Account (ATA) for fee_recipient
    let token_account_address = spl_associated_token_account::get_associated_token_address(
        &owner.pubkey(),
        mint,
    );

    // Inspired by https://github.com/mrgnlabs/marginfi-v2/blob/3b7bf0aceb684a762c8552412001c8d355033119/test-utils/src/spl.rs#L56
    let token_account = {
        let mut ctx = test_ctx.borrow_mut();
        
        // Create instruction using borrowed values
        let create_ata_ix = spl_associated_token_account::instruction::create_associated_token_account(
            &ctx.payer.pubkey(),    // Funding account
            &owner.pubkey(),        // Wallet address
            mint,                   // Mint address
            &spl_token::id(),       // Token program
        );

        // Create and process transaction
        let tx = Transaction::new_signed_with_payer(
            &[create_ata_ix],
            Some(&ctx.payer.pubkey()),
            &[&ctx.payer],
            ctx.last_blockhash,
        );       

        ctx.banks_client.process_transaction(tx).await.unwrap();

        // Get the account
        ctx.banks_client
            .get_account(token_account_address)
            .await
            .unwrap()
            .unwrap_or_else(|| panic!("Failed to get token account"))
    };
    TokenAccountFixture {
        test_ctx: test_ctx_ref,
        address: token_account_address,
        account: spl_token::state::Account::unpack(&token_account.data).unwrap(),
    }
}

/// Reads a keypair from a JSON fixture file
///
/// Reads the JSON file and parses it into a Value object that is used to extract the keypair.
///
/// # Arguments
///
/// * `filename` - The path to the JSON fixture file
pub fn read_keypair_from_file(filename: &str) -> Keypair {
    // Read the JSON file
    let data = fs::read_to_string(filename)
        .expect("Unable to read file");

    // Parse JSON array into Vec<u8>
    let bytes: Vec<u8> = serde_json::from_str(&data)
        .expect("File content must be a JSON array of integers");

    // Create keypair from bytes
    Keypair::from_bytes(&bytes)
        .expect("Bytes must form a valid keypair")
}

// FIXME: This does not work, using the function in the mint.rs file instead
/// Adds an account from a JSON fixture file to the program test
///
/// Loads the JSON file and parses it into a Value object that is used to extract the lamports, address, and owner values.
///
/// # Arguments
///
/// * `program_test` - The program test instance
/// * `filename` - The path to the JSON fixture file
#[allow(dead_code, unused_variables)]
pub fn add_account_from_file(
    program_test: &mut ProgramTest,
    filename: &str,
) {
    // Parse the JSON file to an AccountFixture struct
    let account_fixture = read_account_from_file(filename);
    // Add the account to the program test
    program_test.add_account_with_file_data(account_fixture.address, account_fixture.lamports, account_fixture.owner, filename)
}

#[allow(dead_code, unused_variables)]
struct AccountFixture {
    pub address: Pubkey,
    pub owner: Pubkey,
    pub lamports: u64,
}

// FIXME: This code is not being used, remove it

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
fn read_account_from_file(
    filename: &str,
) -> AccountFixture {
    // Read the JSON file
    let data = fs::read_to_string(filename)
    .expect("Unable to read file");

    // Parse the JSON
    let json: Value = serde_json::from_str(&data)
    .expect("Unable to parse JSON");

    // Extract the lamports value
    let lamports = json["account"]["lamports"]
    .as_u64()
    .expect("lamports field not found or invalid");

    // Extract the address value
    let address: Pubkey = solana_sdk::pubkey::Pubkey::from_str(json["pubkey"].as_str().expect("pubkey field not found or invalid")).expect("Pubkey field in file is not a valid pubkey");
    // Extract the owner address value
    let owner: Pubkey = solana_sdk::pubkey::Pubkey::from_str(json["account"]["owner"].as_str().expect("owner field not found or invalid")).expect("Owner field in file is not a valid pubkey");
    
    AccountFixture {
        address,
        owner,
        lamports,
    }
}