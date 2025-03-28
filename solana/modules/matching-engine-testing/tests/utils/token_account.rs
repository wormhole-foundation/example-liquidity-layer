use anchor_spl::associated_token::spl_associated_token_account;
use anchor_spl::token::spl_token;
use solana_program_test::ProgramTestContext;
use solana_sdk::{
    program_pack::Pack, pubkey::Pubkey, signature::Keypair, signer::Signer,
    transaction::Transaction,
};
use std::{cell::RefCell, fs, rc::Rc};

#[derive(Clone)]
pub struct TokenAccountFixture {
    pub test_ctx: Rc<RefCell<ProgramTestContext>>,
    pub address: Pubkey,
    pub account: spl_token::state::Account,
}

impl std::fmt::Debug for TokenAccountFixture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "TokenAccountFixture {{ address: {}, account: {:?} }}",
            self.address, self.account
        )
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
    let token_account_address =
        spl_associated_token_account::get_associated_token_address(&owner.pubkey(), mint);

    // Inspired by https://github.com/mrgnlabs/marginfi-v2/blob/3b7bf0aceb684a762c8552412001c8d355033119/test-utils/src/spl.rs#L56
    let token_account = {
        let mut ctx = test_ctx.borrow_mut();

        // Create instruction using borrowed values
        let create_ata_ix =
            spl_associated_token_account::instruction::create_associated_token_account(
                &ctx.payer.pubkey(), // Funding account
                &owner.pubkey(),     // Wallet address
                mint,                // Mint address
                &spl_token::id(),    // Token program
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

pub async fn create_token_account_for_pda(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    pda: &Pubkey,  // The PDA that will own the token account
    mint: &Pubkey, // The mint (USDC in your case)
) -> Pubkey {
    let mut ctx = test_context.borrow_mut();

    // Get the ATA address
    let ata = anchor_spl::associated_token::get_associated_token_address(pda, mint);

    // Create the create_ata instruction
    let create_ata_ix = spl_associated_token_account::instruction::create_associated_token_account(
        &ctx.payer.pubkey(), // Funding account
        pda,                 // Account that will own the token account
        mint,                // Token mint (USDC)
        &spl_token::id(),    // Token program
    );

    // Create and send transaction
    let transaction = Transaction::new_signed_with_payer(
        &[create_ata_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );

    ctx.banks_client
        .process_transaction(transaction)
        .await
        .unwrap();

    ata
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
    let data = fs::read_to_string(filename).expect("Unable to read file");

    // Parse JSON array into Vec<u8>
    let bytes: Vec<u8> =
        serde_json::from_str(&data).expect("File content must be a JSON array of integers");

    // Create keypair from bytes
    Keypair::from_bytes(&bytes).expect("Bytes must form a valid keypair")
}
