use solana_program::address_lookup_table::{
    instruction::{create_lookup_table, extend_lookup_table},
    state::AddressLookupTable,
};
use solana_program_test::ProgramTestContext;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, transaction::Transaction};
use solana_program::pubkey;
use std::rc::Rc;
use std::cell::RefCell;

// TODO: Figure out each of these addresses ...
struct LookupTableAddresses {
    pub core_bridge_config: Pubkey,
    pub core_emitter_sequence: Pubkey, // Nothing needs to be done: will be created from first message by bridge
    pub core_fee_collector: Pubkey,
    pub core_bridge_program: Pubkey, // ??
    pub matching_engine_program: Pubkey, // Will need to be loaded as a .so
    pub system_program: Pubkey,
    pub rent: Pubkey,
    pub clock: Pubkey,
    pub custodian: Pubkey,
    pub event_authority: Pubkey, // Derive key for it
    pub cctp_mint_recipient: Pubkey, // Initialised from Initialize
    pub token_messenger: Pubkey,
    pub token_minter: Pubkey,
    pub token_messenger_minter_sender_authority: Pubkey,
    pub token_messenger_minter_program: Pubkey,
    pub message_transmitter_authority: Pubkey,
    pub message_transmitter_config: Pubkey,
    pub message_transmitter_program: Pubkey,
    pub token_program: Pubkey,
    pub mint: Pubkey, // (USDC mint address)
    pub local_token: Pubkey,
    pub token_messenger_minter_custody_token: Pubkey, // usdc custody token
    pub token_messenger_minter_event_authority: Pubkey, // Derive key for it
    pub message_transmitter_event_authority: Pubkey, // Derive key for it
}

impl LookupTableAddresses {
    pub fn new(matching_engine_program: Pubkey, custodian: Pubkey, cctp_mint_recipient: Pubkey, mint: Pubkey) -> Self {
        Self {
            core_bridge_config: pubkey!(""),
            core_emitter_sequence: pubkey!(""),
            core_fee_collector: pubkey!(""),
            core_bridge_program: pubkey!(""),
            matching_engine_program,
            system_program: solana_program::system_program::ID,
            rent: solana_program::sysvar::rent::ID,
            clock: solana_program::sysvar::clock::ID,
            custodian,
            event_authority: pubkey!(""),
            cctp_mint_recipient,
            token_messenger: pubkey!(""),
            token_minter: pubkey!(""),
            token_messenger_minter_sender_authority: pubkey!(""),
            token_messenger_minter_program: pubkey!(""),
            message_transmitter_authority: pubkey!(""),
            message_transmitter_config: pubkey!(""),
            message_transmitter_program: pubkey!(""),
            token_program: anchor_spl::token::ID,
            mint,
            local_token: pubkey!(""),
            token_messenger_minter_custody_token: pubkey!(""),
            token_messenger_minter_event_authority: pubkey!(""),
            message_transmitter_event_authority: pubkey!(""),
        }
    }
}

async fn setup_lookup_table(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    addresses: Vec<Pubkey>,
) -> Pubkey {
    let mut ctx = test_context.borrow_mut();
    
    // Get recent slot
    let slot = ctx.banks_client.get_root_slot().await.unwrap();
    
    // Create lookup table
    let (lookup_table_address, create_ix) = create_lookup_table(
        ctx.payer.pubkey(),  // Authority
        ctx.payer.pubkey(),  // Payer
        slot,                // Recent slot
    );

    // Process create instruction
    let create_tx = Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(create_tx).await.unwrap();

    // Extend lookup table with addresses
    let extend_ix = extend_lookup_table(
        lookup_table_address,
        ctx.payer.pubkey(),  // Authority
        Some(ctx.payer.pubkey()),  // Payer (optional)
        addresses,
    );

    // Process extend instruction
    let extend_tx = Transaction::new_signed_with_payer(
        &[extend_ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(extend_tx).await.unwrap();

    lookup_table_address
}