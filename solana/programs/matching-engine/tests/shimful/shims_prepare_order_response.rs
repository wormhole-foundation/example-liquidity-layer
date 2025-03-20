use super::super::shimless::initialize::InitializeFixture;
use super::super::utils;
use super::shims::PlaceInitialOfferShimFixture;
use super::shims_execute_order::ExecuteOrderFallbackFixture;
use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use common::messages::raw::LiquidityLayerDepositMessage;
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use common::wormhole_cctp_solana::messages::Deposit;
use common::wormhole_cctp_solana::utils::CctpMessage;
use matching_engine::fallback::prepare_order_response::{
    FinalizedVaaMessage, PrepareOrderResponseCctpShim as PrepareOrderResponseCctpShimIx,
    PrepareOrderResponseCctpShimAccounts, PrepareOrderResponseCctpShimData,
};
use matching_engine::state::{FastMarketOrder as FastMarketOrderState, PreparedOrderResponse};
use solana_program_test::ProgramTestContext;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use std::cell::RefCell;
use std::rc::Rc;
use utils::account_fixtures::FixtureAccounts;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

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
        let first_nonce = if nonce == 0 {
            0
        } else {
            (nonce - 1) / Self::MAX_NONCES * Self::MAX_NONCES + 1
        }; // Could potentially use a more efficient algorithm, but this finds the first nonce in a bucket
        let remote_domain_converted = remote_domain.to_string();
        let first_nonce_converted = first_nonce.to_string();
        Pubkey::find_program_address(
            &[
                b"used_nonces",
                remote_domain_converted.as_bytes(),
                first_nonce_converted.as_bytes(),
            ],
            &MESSAGE_TRANSMITTER_PROGRAM_ID,
        )
    }
}

impl PrepareOrderResponseShimAccountsFixture {
    pub fn new(
        signer: &Pubkey,
        fixture_accounts: &FixtureAccounts,
        execute_order_fixture: &ExecuteOrderFallbackFixture,
        initial_offer_fixture: &PlaceInitialOfferShimFixture,
        initialize_fixture: &InitializeFixture,
        from_router_endpoint: &Pubkey,
        to_router_endpoint: &Pubkey,
        usdc_mint_address: &Pubkey,
        cctp_message_decoded: &CctpMessageDecoded,
        guardian_set: &Pubkey,
        guardian_set_signatures: &Pubkey,
    ) -> Self {
        let cctp_message_transmitter_event_authority =
            Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &MESSAGE_TRANSMITTER_PROGRAM_ID)
                .0;
        let cctp_message_transmitter_authority = Pubkey::find_program_address(
            &[
                b"message_transmitter_authority",
                &TOKEN_MESSENGER_MINTER_PROGRAM_ID.as_ref(),
            ],
            &MESSAGE_TRANSMITTER_PROGRAM_ID,
        )
        .0;
        let (cctp_used_nonces_pda, _cctp_used_nonces_bump) = UsedNonces::address(
            cctp_message_decoded.source_domain,
            cctp_message_decoded.nonce,
        );
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
            cctp_message_transmitter_event_authority: cctp_message_transmitter_event_authority
                .clone(),
            cctp_token_messenger: fixture_accounts.token_messenger.clone(),
            cctp_remote_token_messenger: fixture_accounts.ethereum_remote_token_messenger.clone(),
            cctp_token_minter: fixture_accounts.token_minter.clone(),
            cctp_local_token: fixture_accounts.usdc_local_token.clone(),
            cctp_token_pair: fixture_accounts.usdc_token_pair.clone(),
            cctp_token_messenger_minter_custody_token: fixture_accounts.usdc_custody_token.clone(),
            cctp_token_messenger_minter_program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
            cctp_message_transmitter_program: MESSAGE_TRANSMITTER_PROGRAM_ID,
            cctp_token_messenger_minter_event_authority: execute_order_fixture
                .accounts
                .token_messenger_minter_event_authority
                .clone(),
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
    pub vaa_payload: Vec<u8>,
    pub deposit_payload: Vec<u8>,
    pub fast_market_order: FastMarketOrderState,
    pub guardian_set_bump: u8,
}

impl PrepareOrderResponseShimDataFixture {
    pub fn new(
        encoded_cctp_message: Vec<u8>,
        cctp_attestation: Vec<u8>,
        deposit_vaa_data: &utils::vaa::PostedVaaData,
        deposit: &Deposit,
        deposit_base_fee: u64,
        fast_market_order: &FastMarketOrderState,
        guardian_set_bump: u8,
    ) -> Self {
        Self {
            encoded_cctp_message,
            cctp_attestation,
            finalized_vaa_message_sequence: deposit_vaa_data.sequence,
            finalized_vaa_message_timestamp: deposit_vaa_data.vaa_time,
            finalized_vaa_message_emitter_chain: deposit_vaa_data.emitter_chain,
            finalized_vaa_message_emitter_address: deposit_vaa_data.emitter_address,
            finalized_vaa_message_base_fee: deposit_base_fee,
            vaa_payload: deposit_vaa_data.payload.to_vec(),
            deposit_payload: deposit.payload.to_vec(),
            fast_market_order: fast_market_order.clone(),
            guardian_set_bump,
        }
    }
    pub fn decode_cctp_message(&self) -> CctpMessageDecoded {
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
) -> Result<PrepareOrderResponseShimFixture> {
    let fast_market_order_digest = data.fast_market_order.digest();
    let prepared_order_response_seeds = [
        PreparedOrderResponse::SEED_PREFIX,
        &fast_market_order_digest,
    ];

    let (prepared_order_response_pda, _prepared_order_response_bump) =
        Pubkey::find_program_address(&prepared_order_response_seeds, matching_engine_program_id);

    let prepared_custody_token_seeds = [
        matching_engine::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
        prepared_order_response_pda.as_ref(),
    ];
    let (prepared_custody_token_pda, _prepared_custody_token_bump) =
        Pubkey::find_program_address(&prepared_custody_token_seeds, matching_engine_program_id);

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
        cctp_message_transmitter_event_authority: &accounts
            .cctp_message_transmitter_event_authority,
        cctp_token_messenger: &accounts.cctp_token_messenger,
        cctp_remote_token_messenger: &accounts.cctp_remote_token_messenger,
        cctp_token_minter: &accounts.cctp_token_minter,
        cctp_local_token: &accounts.cctp_local_token,
        cctp_token_pair: &accounts.cctp_token_pair,
        cctp_token_messenger_minter_event_authority: &accounts
            .cctp_token_messenger_minter_event_authority,
        cctp_token_messenger_minter_custody_token: &accounts
            .cctp_token_messenger_minter_custody_token,
        cctp_token_messenger_minter_program: &accounts.cctp_token_messenger_minter_program,
        cctp_message_transmitter_program: &accounts.cctp_message_transmitter_program,
        guardian_set: &accounts.guardian_set,
        guardian_set_signatures: &accounts.guardian_set_signatures,
        verify_shim_program: &wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID,
        token_program: &spl_token::ID,
        system_program: &solana_program::system_program::ID,
    };

    let finalized_vaa_message = FinalizedVaaMessage {
        base_fee: data.finalized_vaa_message_base_fee,
        vaa_payload: data.vaa_payload,
        deposit_payload: data.deposit_payload,
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
    }
    .instruction();

    let recent_blockhash = test_ctx
        .borrow_mut()
        .get_new_latest_blockhash()
        .await
        .expect("Failed to get new latest blockhash");
    let transaction = Transaction::new_signed_with_payer(
        &[prepare_order_response_cctp_shim_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        recent_blockhash,
    );
    test_ctx
        .borrow_mut()
        .banks_client
        .process_transaction(transaction)
        .await
        .expect("Failed to process prepare order response cctp shim");
    Ok(PrepareOrderResponseShimFixture {
        prepared_order_response: prepared_order_response_pda,
        prepared_custody_token: prepared_custody_token_pda,
    })
}

pub fn get_deposit_base_fee(deposit: &Deposit) -> u64 {
    // TODO: Fix this
    let payload = deposit.payload.clone();
    let liquidity_layer_message = LiquidityLayerDepositMessage::parse(&payload).unwrap();
    let slow_order_response = liquidity_layer_message
        .slow_order_response()
        .expect("Failed to get slow order response");
    let base_fee = slow_order_response.base_fee();
    base_fee
}

pub async fn prepare_order_response_test(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
    deposit_vaa_data: &utils::vaa::PostedVaaData,
    core_bridge_program_id: &Pubkey,
    matching_engine_program_id: &Pubkey,
    fixture_accounts: &FixtureAccounts,
    execute_order_fixture: &ExecuteOrderFallbackFixture,
    initial_offer_fixture: &PlaceInitialOfferShimFixture,
    initialize_fixture: &InitializeFixture,
    eth_endpoint_address: &Pubkey,
    arb_endpoint_address: &Pubkey,
    usdc_mint_address: &Pubkey,
    cctp_mint_recipient: &Pubkey,
    custodian_address: &Pubkey,
    deposit: &Deposit,
) -> Result<PrepareOrderResponseShimFixture> {
    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
        super::shims::create_guardian_signatures(
            test_ctx,
            payer_signer,
            deposit_vaa_data,
            core_bridge_program_id,
            None,
        )
        .await;

    let source_remote_token_messenger = utils::router::get_remote_token_messenger(
        test_ctx,
        fixture_accounts.ethereum_remote_token_messenger,
    )
    .await;
    let cctp_nonce = deposit.cctp_nonce;
    println!("cctp nonce: {:?}", cctp_nonce);

    let message_transmitter_config_pubkey = fixture_accounts.message_transmitter_config;
    let fast_market_order_state = initial_offer_fixture.fast_market_order;
    // TODO: Make checks to see if fast market order sender matches cctp message sender ...
    let cctp_message_decoded = utils::cctp_message::craft_cctp_token_burn_message(
        test_ctx,
        source_remote_token_messenger.domain,
        cctp_nonce,
        deposit.amount,
        &message_transmitter_config_pubkey,
        &(&source_remote_token_messenger).into(),
        cctp_mint_recipient,
        custodian_address,
    )
    .await
    .unwrap();
    cctp_message_decoded
        .verify_cctp_message(&fast_market_order_state)
        .unwrap();

    let deposit_base_fee = super::shims_prepare_order_response::get_deposit_base_fee(&deposit);
    let prepare_order_response_cctp_shim_data = PrepareOrderResponseShimDataFixture::new(
        cctp_message_decoded.encoded_cctp_burn_message,
        cctp_message_decoded.cctp_attestation,
        &deposit_vaa_data,
        &deposit,
        deposit_base_fee,
        &fast_market_order_state,
        guardian_set_bump,
    );
    let cctp_message_decoded = prepare_order_response_cctp_shim_data.decode_cctp_message();
    let prepare_order_response_cctp_shim_accounts = PrepareOrderResponseShimAccountsFixture::new(
        &payer_signer.pubkey(),
        &fixture_accounts,
        &execute_order_fixture,
        &initial_offer_fixture,
        &initialize_fixture,
        &eth_endpoint_address,
        &arb_endpoint_address,
        &usdc_mint_address,
        &cctp_message_decoded,
        &guardian_set_pubkey,
        &guardian_signatures_pubkey,
    );
    let result = super::shims_prepare_order_response::prepare_order_response_cctp_shim(
        test_ctx,
        payer_signer,
        prepare_order_response_cctp_shim_accounts,
        prepare_order_response_cctp_shim_data,
        matching_engine_program_id,
    )
    .await;
    assert!(result.is_ok());
    result
}

pub struct PrepareOrderResponseShimFixture {
    pub prepared_order_response: Pubkey,
    pub prepared_custody_token: Pubkey,
}
