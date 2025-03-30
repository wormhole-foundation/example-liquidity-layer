use anchor_spl::token::spl_token;
use solana_program_test::ProgramTestContext;
use solana_sdk::transaction::{Transaction, VersionedTransaction};
use solana_sdk::{pubkey::Pubkey, signature::Signer, system_instruction};

use super::constants;

/// Airdrops SOL to a given recipient
///
/// # Arguments
///
/// * `test_context` - The test context
/// * `recipient` - The recipient of the airdrop        
/// * `amount` - The amount of SOL to airdrop

pub async fn airdrop(test_context: &mut ProgramTestContext, recipient: &Pubkey, amount: u64) {
    // Create the transfer instruction with values from the context
    let transfer_ix = system_instruction::transfer(&test_context.payer.pubkey(), recipient, amount);

    // Create and send transaction
    let tx = Transaction::new_signed_with_payer(
        &[transfer_ix.clone()],
        Some(&test_context.payer.pubkey()),
        &[&test_context.payer],
        test_context.last_blockhash,
    );

    test_context
        .banks_client
        .process_transaction(tx)
        .await
        .unwrap();
}

pub async fn airdrop_usdc(
    test_context: &mut ProgramTestContext,
    recipient_ata: &Pubkey,
    amount: u64,
) {
    let new_blockhash = test_context
        .get_new_latest_blockhash()
        .await
        .expect("Failed to get new blockhash");
    let usdc_mint_address = constants::USDC_MINT;
    let mint_to_ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &usdc_mint_address,
        recipient_ata,
        &test_context.payer.pubkey(),
        &[],
        amount,
    )
    .expect("Failed to create mint to instruction");
    let tx = Transaction::new_signed_with_payer(
        &[mint_to_ix.clone()],
        Some(&test_context.payer.pubkey()),
        &[&test_context.payer],
        new_blockhash,
    );

    let versioned_transaction = VersionedTransaction::from(tx);
    test_context
        .banks_client
        .process_transaction(versioned_transaction)
        .await
        .unwrap();
}
