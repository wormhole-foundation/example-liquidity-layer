use crate::testing_engine::config::ExpectedError;
use crate::testing_engine::state::TestingEngineState;
use crate::utils::setup::{TestingContext, TransferDirection};

use super::super::utils;
use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
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
use matching_engine::CCTP_MINT_RECIPIENT;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use std::rc::Rc;
use utils::account_fixtures::FixtureAccounts;
use utils::cctp_message::{CctpMessageDecoded, UsedNonces};
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

impl PrepareOrderResponseShimAccountsFixture {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        signer: &Pubkey,
        fixture_accounts: &FixtureAccounts,
        custodian_address: &Pubkey,
        fast_market_order_address: &Pubkey,
        from_router_endpoint: &Pubkey,
        to_router_endpoint: &Pubkey,
        usdc_mint_address: &Pubkey,
        cctp_message_decoded: &CctpMessageDecoded,
        guardian_set: &Pubkey,
        guardian_set_signatures: &Pubkey,
        transfer_direction: &TransferDirection,
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
        let token_messenger_minter_event_authority = Pubkey::find_program_address(
            &[EVENT_AUTHORITY_SEED],
            &TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        )
        .0;
        let (cctp_used_nonces_pda, _cctp_used_nonces_bump) = UsedNonces::address(
            cctp_message_decoded.source_domain,
            cctp_message_decoded.nonce,
        );
        let cctp_remote_token_messenger = match transfer_direction {
            TransferDirection::FromEthereumToArbitrum => {
                fixture_accounts.ethereum_remote_token_messenger
            }
            TransferDirection::FromArbitrumToEthereum => {
                fixture_accounts.arbitrum_remote_token_messenger
            }
            _ => panic!("Unsupported transfer direction"),
        };
        Self {
            signer: *signer,
            custodian: *custodian_address,
            fast_market_order: *fast_market_order_address,
            from_endpoint: *from_router_endpoint,
            to_endpoint: *to_router_endpoint,
            base_fee_token: *usdc_mint_address, // Change this to the solver's address?
            usdc: *usdc_mint_address,
            cctp_mint_recipient: CCTP_MINT_RECIPIENT,
            cctp_message_transmitter_authority,
            cctp_message_transmitter_config: fixture_accounts.message_transmitter_config,
            cctp_used_nonces: cctp_used_nonces_pda,
            cctp_message_transmitter_event_authority,
            cctp_token_messenger: fixture_accounts.token_messenger,
            cctp_remote_token_messenger,
            cctp_token_minter: fixture_accounts.token_minter,
            cctp_local_token: fixture_accounts.usdc_local_token,
            cctp_token_pair: fixture_accounts.usdc_token_pair,
            cctp_token_messenger_minter_custody_token: fixture_accounts.usdc_custody_token,
            cctp_token_messenger_minter_program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
            cctp_message_transmitter_program: MESSAGE_TRANSMITTER_PROGRAM_ID,
            cctp_token_messenger_minter_event_authority: token_messenger_minter_event_authority,
            guardian_set: *guardian_set,
            guardian_set_signatures: *guardian_set_signatures,
        }
    }
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
            fast_market_order: *fast_market_order,
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
    testing_context: &TestingContext,
    payer_signer: &Rc<Keypair>,
    accounts: PrepareOrderResponseShimAccountsFixture,
    data: PrepareOrderResponseShimDataFixture,
    matching_engine_program_id: &Pubkey,
    expected_error: Option<&ExpectedError>,
) -> Option<PrepareOrderResponseShimFixture> {
    let test_ctx = &testing_context.test_context;
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
    testing_context
        .execute_and_verify_transaction(transaction, expected_error)
        .await;
    if expected_error.is_none() {
        Some(PrepareOrderResponseShimFixture {
            prepared_order_response: prepared_order_response_pda,
            prepared_custody_token: prepared_custody_token_pda,
        })
    } else {
        None
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn prepare_order_response_test(
    testing_context: &TestingContext,
    payer_signer: &Rc<Keypair>,
    deposit_vaa_data: &utils::vaa::PostedVaaData,
    testing_engine_state: &TestingEngineState,
    to_endpoint_address: &Pubkey,
    from_endpoint_address: &Pubkey,
    deposit: &Deposit,
    expected_error: Option<&ExpectedError>,
) -> Option<PrepareOrderResponseShimFixture> {
    let test_ctx = &testing_context.test_context;
    let core_bridge_program_id = &testing_context.get_wormhole_program_id();
    let matching_engine_program_id = &testing_context.get_matching_engine_program_id();
    let usdc_mint_address = &testing_context.get_usdc_mint_address();
    let cctp_mint_recipient = &testing_context.get_cctp_mint_recipient();

    let fixture_accounts = testing_context
        .fixture_accounts
        .clone()
        .expect("Fixture accounts not found");

    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) =
        super::verify_shim::create_guardian_signatures(
            testing_context,
            payer_signer,
            deposit_vaa_data,
            core_bridge_program_id,
            None,
        )
        .await
        .unwrap();

    let source_remote_token_messenger = match testing_context.testing_state.transfer_direction {
        TransferDirection::FromEthereumToArbitrum => {
            utils::router::get_remote_token_messenger(
                testing_context,
                fixture_accounts.ethereum_remote_token_messenger,
            )
            .await
        }
        _ => panic!("Unsupported transfer direction"),
    };
    let cctp_nonce = deposit.cctp_nonce;

    let message_transmitter_config_pubkey = fixture_accounts.message_transmitter_config;
    let fast_market_order_state = testing_engine_state
        .fast_market_order()
        .expect("could not find fast market order")
        .fast_market_order;
    let custodian_address = testing_engine_state
        .custodian_address()
        .expect("Custodian address not found");
    // TODO: Make checks to see if fast market order sender matches cctp message sender ...
    let cctp_token_burn_message = utils::cctp_message::craft_cctp_token_burn_message(
        test_ctx,
        source_remote_token_messenger.domain,
        cctp_nonce,
        deposit.amount,
        &message_transmitter_config_pubkey,
        &(&source_remote_token_messenger).into(),
        cctp_mint_recipient,
        &custodian_address,
    )
    .await
    .unwrap();
    cctp_token_burn_message
        .verify_cctp_message(&fast_market_order_state)
        .unwrap();

    let deposit_base_fee = utils::cctp_message::get_deposit_base_fee(deposit);
    let prepare_order_response_cctp_shim_data = PrepareOrderResponseShimDataFixture::new(
        cctp_token_burn_message.encoded_cctp_burn_message,
        cctp_token_burn_message.cctp_attestation,
        deposit_vaa_data,
        deposit,
        deposit_base_fee,
        &fast_market_order_state,
        guardian_set_bump,
    );
    let fast_market_order_address = testing_engine_state
        .fast_market_order()
        .expect("could not find fast market order")
        .fast_market_order_address;
    let cctp_message_decoded = prepare_order_response_cctp_shim_data.decode_cctp_message();
    let prepare_order_response_cctp_shim_accounts = PrepareOrderResponseShimAccountsFixture::new(
        &payer_signer.pubkey(),
        &fixture_accounts,
        &custodian_address,
        &fast_market_order_address,
        from_endpoint_address,
        to_endpoint_address,
        usdc_mint_address,
        &cctp_message_decoded,
        &guardian_set_pubkey,
        &guardian_signatures_pubkey,
        &testing_context.testing_state.transfer_direction,
    );
    super::shims_prepare_order_response::prepare_order_response_cctp_shim(
        testing_context,
        payer_signer,
        prepare_order_response_cctp_shim_accounts,
        prepare_order_response_cctp_shim_data,
        matching_engine_program_id,
        expected_error,
    )
    .await
}

pub struct PrepareOrderResponseShimFixture {
    pub prepared_order_response: Pubkey,
    pub prepared_custody_token: Pubkey,
}
