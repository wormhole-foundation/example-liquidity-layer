use solana_program_test::ProgramTestContext;
use std::rc::Rc;
use std::cell::RefCell;
use solana_sdk::{
    pubkey::Pubkey,
    system_instruction,
    signature::Signer,
};
use solana_sdk::transaction::Transaction;


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