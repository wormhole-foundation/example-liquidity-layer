use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use common::messages::SlowOrderResponse;
use common::wormhole_cctp_solana::messages::Deposit;
use common::wormhole_cctp_solana::utils::CctpMessage;
use matching_engine::fallback::prepare_order_response::{
    DepositMessage, FinalizedVaaMessage, PrepareOrderResponseCctpShim as PrepareOrderResponseCctpShimIx, PrepareOrderResponseCctpShimAccounts, PrepareOrderResponseCctpShimData};
use matching_engine::state::{FastMarketOrder as FastMarketOrderState, PreparedOrderResponse};
use solana_program_test::ProgramTestContext;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use wormhole_io::TypePrefixedPayload;
use std::rc::Rc;
use std::cell::RefCell;
use common::wormhole_cctp_solana::cctp::{MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID};
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

use super::account_fixtures::FixtureAccounts;
use super::initialize::InitializeFixture;
use super::shims::PlaceInitialOfferShimFixture;
use super::shims_execute_order::ExecuteOrderFallbackFixture;

pub struct PrepareOrderResponseShimAccountsFixture {
    pub signer: Pubkey,
    pub custodian: Pubkey,
    pub fast_market_order: Pubkey,
    pub from_endpoint: Pubkey,
    pub to_endpoint: Pubkey,
    pub base_fee_token: Pubkey,
    pub usdc: Pubkey,
    pub cctp_mint_recipient: Pubkey,
    pub cctp_message_transmitter_authority: Pubkey,
    pub cctp_message_transmitter_config: Pubkey,
    pub cctp_used_nonces: Pubkey,
    pub cctp_message_transmitter_event_authority: Pubkey,
    pub cctp_token_messenger: Pubkey,
    pub cctp_remote_token_messenger: Pubkey,
    pub cctp_token_minter: Pubkey,
    pub cctp_local_token: Pubkey,
    pub cctp_token_messenger_minter_custody_token: Pubkey,
    pub cctp_token_messenger_minter_program: Pubkey,
    pub cctp_message_transmitter_program: Pubkey,
    pub cctp_token_pair: Pubkey,
    pub cctp_token_messenger_minter_event_authority: Pubkey,
    pub guardian_set: Pubkey,
    pub guardian_set_signatures: Pubkey,
}

struct UsedNonces;

impl UsedNonces {
    pub const MAX_NONCES: u64 = 6400;
    pub fn address(remote_domain: u32, nonce: u64) -> (Pubkey, u8) {
        let first_nonce = (nonce - 1) / Self::MAX_NONCES * Self::MAX_NONCES + 1; // Could potentially use a more efficient algorithm, but this finds the first nonce in a bucket
        let remote_domain_converted = remote_domain.to_string();
        let first_nonce_converted = first_nonce.to_string();
        Pubkey::find_program_address(&[
            b"used_nonces",
            remote_domain_converted.as_bytes(),
            first_nonce_converted.as_bytes(),
        ], &MESSAGE_TRANSMITTER_PROGRAM_ID)
    }
}

impl PrepareOrderResponseShimAccountsFixture {
    pub fn new(signer: &Pubkey, 
        fixture_accounts: &FixtureAccounts, 
        execute_order_fixture: &ExecuteOrderFallbackFixture, 
        initial_offer_fixture: &PlaceInitialOfferShimFixture, 
        initialize_fixture: &InitializeFixture,
        to_router_endpoint: &Pubkey,
        from_router_endpoint: &Pubkey,
        usdc_mint_address: &Pubkey,
        cctp_message_decoded: &CctpMessageDecoded,
        guardian_set: &Pubkey,
        guardian_set_signatures: &Pubkey,
    ) -> Self {
        let cctp_message_transmitter_event_authority = Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
        let cctp_message_transmitter_authority = Pubkey::find_program_address(&[b"message_transmitter_authority", &TOKEN_MESSENGER_MINTER_PROGRAM_ID.as_ref()], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
        let (cctp_used_nonces_pda, _cctp_used_nonces_bump) = UsedNonces::address(cctp_message_decoded.source_domain, cctp_message_decoded.nonce);
        Self {
            signer: signer.clone(),
            custodian: initialize_fixture.get_custodian_address(),
            fast_market_order: initial_offer_fixture.fast_market_order_address,
            from_endpoint: from_router_endpoint.clone(),
            to_endpoint: to_router_endpoint.clone(),
            base_fee_token: usdc_mint_address.clone(), // Change this to the solver's address?
            usdc: usdc_mint_address.clone(),
            cctp_mint_recipient: initialize_fixture.addresses.cctp_mint_recipient.clone(),
            cctp_message_transmitter_authority: cctp_message_transmitter_authority.clone(),
            cctp_message_transmitter_config: fixture_accounts.message_transmitter_config.clone(),
            cctp_used_nonces: cctp_used_nonces_pda.clone(),
            cctp_message_transmitter_event_authority: cctp_message_transmitter_event_authority.clone(),
            cctp_token_messenger: fixture_accounts.arbitrum_remote_token_messenger.clone(),
            cctp_remote_token_messenger: fixture_accounts.ethereum_remote_token_messenger.clone(),
            cctp_token_minter: fixture_accounts.token_minter.clone(),
            cctp_local_token: fixture_accounts.usdc_local_token.clone(),
            cctp_token_pair: fixture_accounts.usdc_token_pair.clone(),
            cctp_token_messenger_minter_custody_token: fixture_accounts.usdc_custody_token.clone(), 
            cctp_token_messenger_minter_program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
            cctp_message_transmitter_program: MESSAGE_TRANSMITTER_PROGRAM_ID,
            cctp_token_messenger_minter_event_authority: execute_order_fixture.accounts.token_messenger_minter_event_authority.clone(), 
            guardian_set: guardian_set.clone(),
            guardian_set_signatures: guardian_set_signatures.clone(),
        }
    }
}

pub struct CctpMessageDecoded {
    pub nonce: u64,
    pub source_domain: u32,
}

pub struct PrepareOrderResponseShimDataFixture {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message_sequence: u64,
    pub finalized_vaa_message_timestamp: u32,
    pub finalized_vaa_message_emitter_chain: u16,
    pub finalized_vaa_message_emitter_address: [u8; 32],
    pub finalized_vaa_message_base_fee: u64,
    pub deposit_message: DepositMessage,
    pub fast_market_order: FastMarketOrderState,
    pub guardian_set_bump: u8,
}

impl PrepareOrderResponseShimDataFixture {
    pub fn new(
        encoded_cctp_message: Vec<u8>,
        cctp_attestation: Vec<u8>,
        deposit_vaa_data: &super::vaa::PostedVaaData,
        deposit: &Deposit,
        deposit_base_fee: u64,
        fast_market_order: &FastMarketOrderState,
        guardian_set_bump: u8,
    ) -> Self {
        let deposit_message = DepositMessage {
            token_address: deposit.token_address,
            amount: deposit.amount.to_le_bytes(),
            source_cctp_domain: deposit.source_cctp_domain,
            destination_cctp_domain: deposit.destination_cctp_domain,
            cctp_nonce: deposit.cctp_nonce,
            burn_source: deposit.burn_source,
            mint_recipient: deposit.mint_recipient,
            digest: deposit_vaa_data.digest(),
            payload_len: deposit_vaa_data.payload.len() as u16,
            payload: deposit_vaa_data.payload.clone(),
        };
        Self {
            encoded_cctp_message,
            cctp_attestation,
            finalized_vaa_message_sequence: deposit_vaa_data.sequence,
            finalized_vaa_message_timestamp: deposit_vaa_data.vaa_time,
            finalized_vaa_message_emitter_chain: deposit_vaa_data.emitter_chain,
            finalized_vaa_message_emitter_address: deposit_vaa_data.emitter_address,
            finalized_vaa_message_base_fee: deposit_base_fee,
            deposit_message,
            fast_market_order: fast_market_order.clone(),
            guardian_set_bump,
        }
    }
    pub fn decode_cctp_message(
        &self,
    ) -> CctpMessageDecoded {
        let cctp_message_decoded = CctpMessage::parse(&self.encoded_cctp_message[..]).unwrap();
        CctpMessageDecoded {
            nonce: cctp_message_decoded.nonce(),
            source_domain: cctp_message_decoded.source_domain(),
        }
    }
}

pub async fn prepare_order_response_cctp_shim(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
    accounts: PrepareOrderResponseShimAccountsFixture,
    data: PrepareOrderResponseShimDataFixture,
    matching_engine_program_id: &Pubkey,
) -> Result<()> {
    let prepared_order_response_seeds = [
        PreparedOrderResponse::SEED_PREFIX,
        &data.fast_market_order.digest
    ];

    let (prepared_order_response_pda, prepared_order_response_bump) = Pubkey::find_program_address(&prepared_order_response_seeds, matching_engine_program_id);
    
    let prepared_custody_token_seeds = [
        matching_engine::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
        prepared_order_response_pda.as_ref(),
    ];
    let (prepared_custody_token_pda, prepared_custody_token_bump) = Pubkey::find_program_address(&prepared_custody_token_seeds, matching_engine_program_id);
    
    let ix_accounts = PrepareOrderResponseCctpShimAccounts {
        signer: &accounts.signer,
        custodian: &accounts.custodian,
        fast_market_order: &accounts.fast_market_order,
        from_endpoint: &accounts.from_endpoint,
        to_endpoint: &accounts.to_endpoint,
        prepared_order_response: &prepared_order_response_pda,
        prepared_custody_token: &prepared_custody_token_pda,
        base_fee_token: &accounts.base_fee_token,
        usdc: &accounts.usdc,
        cctp_mint_recipient: &accounts.cctp_mint_recipient,
        cctp_message_transmitter_authority: &accounts.cctp_message_transmitter_authority,
        cctp_message_transmitter_config: &accounts.cctp_message_transmitter_config,
        cctp_used_nonces: &accounts.cctp_used_nonces,
        cctp_message_transmitter_event_authority: &accounts.cctp_message_transmitter_event_authority,
        cctp_token_messenger: &accounts.cctp_token_messenger,
        cctp_remote_token_messenger: &accounts.cctp_remote_token_messenger,
        cctp_token_minter: &accounts.cctp_token_minter,
        cctp_local_token: &accounts.cctp_local_token,
        cctp_token_pair: &accounts.cctp_token_pair,
        cctp_token_messenger_minter_event_authority: &accounts.cctp_token_messenger_minter_event_authority,
        cctp_token_messenger_minter_custody_token: &accounts.cctp_token_messenger_minter_custody_token,
        cctp_token_messenger_minter_program: &accounts.cctp_token_messenger_minter_program,
        cctp_message_transmitter_program: &accounts.cctp_message_transmitter_program,
        guardian_set: &accounts.guardian_set,
        guardian_set_signatures: &accounts.guardian_set_signatures,
        verify_shim_program: &wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID,
        token_program: &spl_token::ID,
        system_program: &solana_program::system_program::ID,
    };

    let finalized_vaa_message = FinalizedVaaMessage {
        vaa_sequence: data.finalized_vaa_message_sequence,
        vaa_timestamp: data.finalized_vaa_message_timestamp,
        vaa_emitter_chain: data.finalized_vaa_message_emitter_chain,
        vaa_emitter_address: data.finalized_vaa_message_emitter_address,
        base_fee: data.finalized_vaa_message_base_fee,
        deposit_message: data.deposit_message,
        guardian_set_bump: data.guardian_set_bump,
    };

    let data = PrepareOrderResponseCctpShimData {
        encoded_cctp_message: data.encoded_cctp_message,
        cctp_attestation: data.cctp_attestation,
        finalized_vaa_message,
    };
    
    let prepare_order_response_cctp_shim_ix = PrepareOrderResponseCctpShimIx {
        program_id: matching_engine_program_id,
        accounts: ix_accounts,
        data,
    }.instruction();

    let recent_blockhash = test_ctx.borrow_mut().get_new_latest_blockhash().await.expect("Failed to get new latest blockhash");
    let transaction = Transaction::new_signed_with_payer(&[prepare_order_response_cctp_shim_ix], Some(&payer_signer.pubkey()), &[&payer_signer], recent_blockhash);
    test_ctx.borrow_mut().banks_client.process_transaction(transaction).await.expect("Failed to process prepare order response cctp shim");
    Ok(())
}