use anchor_lang::prelude::*;
use anchor_lang::ToAccountInfo;
use anchor_spl::token::spl_token;
use solana_program_test::ProgramTestContext;
use std::rc::Rc;
use std::cell::RefCell;
use solana_sdk::{
    pubkey::Pubkey,
    system_instruction,
    signature::Signer,
};
use solana_sdk::transaction::Transaction;

use super::constants;

/// Airdrops SOL to a given recipient
///
/// # Arguments
///
/// * `test_context` - The test context
/// * `recipient` - The recipient of the airdrop        
/// * `amount` - The amount of SOL to airdrop

pub async fn airdrop(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    recipient: &Pubkey,
    amount: u64,
) {
    let mut ctx = test_context.borrow_mut();
    
    // Create the transfer instruction with values from the context
    let transfer_ix = system_instruction::transfer(
        &ctx.payer.pubkey(),
        recipient,
        amount,
    );

    // Create and send transaction
    let tx = Transaction::new_signed_with_payer(
        &[transfer_ix.clone()],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );

    ctx.banks_client.process_transaction(tx).await.unwrap();
}

pub async fn airdrop_usdc(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    recipient_ata: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) {
    let usdc_mint_address = constants::USDC_MINT;
    let mint_to_ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &usdc_mint_address,
        recipient_ata,
        &test_context.borrow().payer.pubkey(),
        &[],
        amount
    ).expect("Failed to create mint to instruction");
    let tx = Transaction::new_signed_with_payer(
        &[mint_to_ix.clone()],
        Some(&test_context.borrow().payer.pubkey()),
        &[&test_context.borrow().payer],
        test_context.borrow().last_blockhash,
    );

    test_context.borrow_mut().banks_client.process_transaction(tx).await.unwrap();
}
