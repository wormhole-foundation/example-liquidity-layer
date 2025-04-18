use crate::testing_engine::config::{
    ExpectedError, InstructionConfig, PrepareOrderResponseInstructionConfig,
};
use crate::testing_engine::setup::{TestingContext, TransferDirection};
use crate::testing_engine::state::TestingEngineState;

use super::super::utils;
use super::verify_shim::GuardianSignatureInfo;
use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use common::wormhole_cctp_solana::utils::CctpMessage;
use matching_engine::fallback::prepare_order_response::{
    FinalizedVaaMessageArgs, PrepareOrderResponseCctpShim as PrepareOrderResponseCctpShimIx,
    PrepareOrderResponseCctpShimAccounts, PrepareOrderResponseCctpShimData,
};
use matching_engine::state::{FastMarketOrder as FastMarketOrderState, PreparedOrderResponse};
use matching_engine::CCTP_MINT_RECIPIENT;
use solana_program_test::ProgramTestContext;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use std::rc::Rc;
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
    pub fn new(
        testing_context: &TestingContext,
        config: &PrepareOrderResponseInstructionConfig,
        current_state: &TestingEngineState,
        signer: &Pubkey,
        cctp_message_decoded: &CctpMessageDecoded,
        guardian_signature_info: &GuardianSignatureInfo,
    ) -> Self {
        let usdc_mint_address = testing_context.get_usdc_mint_address();
        let auction_accounts = current_state
            .auction_accounts()
            .expect("Auction accounts not found");
        let to_endpoint = auction_accounts.to_router_endpoint;
        let from_endpoint = auction_accounts.from_router_endpoint;
        let fast_market_order = current_state
            .fast_market_order()
            .expect("could not find fast market order")
            .fast_market_order_address;
        let base_fee_token = config
            .actor_enum
            .get_actor(&testing_context.testing_actors)
            .token_account_address(&config.token_enum)
            .unwrap();
        let fixture_accounts = testing_context
            .fixture_accounts
            .clone()
            .expect("Fixture accounts not found");
        let custodian = current_state
            .custodian_address()
            .expect("Custodian address not found");
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
        let cctp_remote_token_messenger = match testing_context.transfer_direction {
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
            custodian,
            fast_market_order,
            from_endpoint,
            to_endpoint,
            base_fee_token,
            usdc: usdc_mint_address,
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
            guardian_set: guardian_signature_info.guardian_set_pubkey,
            guardian_set_signatures: guardian_signature_info.guardian_signatures_pubkey,
        }
    }
}

pub struct PrepareOrderResponseShimDataFixture {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message_args: FinalizedVaaMessageArgs,
    pub fast_market_order: FastMarketOrderState,
}

// Helper struct for creating the data for the prepare order response instruction
impl PrepareOrderResponseShimDataFixture {
    pub fn new(
        encoded_cctp_message: Vec<u8>,
        cctp_attestation: Vec<u8>,
        consistency_level: u8,
        base_fee: u64,
        fast_market_order: &FastMarketOrderState,
        guardian_set_bump: u8,
    ) -> Self {
        Self {
            encoded_cctp_message,
            cctp_attestation,
            finalized_vaa_message_args: FinalizedVaaMessageArgs {
                consistency_level,
                base_fee,
                guardian_set_bump,
            },
            fast_market_order: *fast_market_order,
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

/// Executes the instruction that prepares the order response for the CCTP shim
pub async fn prepare_order_response_cctp_shim(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    payer_signer: &Rc<Keypair>,
    accounts: PrepareOrderResponseShimAccountsFixture,
    data: PrepareOrderResponseShimDataFixture,
    expected_error: Option<&ExpectedError>,
) -> Option<PrepareOrderResponseShimFixture> {
    let matching_engine_program_id = &testing_context.get_matching_engine_program_id();
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

    let finalized_vaa_message_args = data.finalized_vaa_message_args;
    let data = PrepareOrderResponseCctpShimData {
        encoded_cctp_message: data.encoded_cctp_message,
        cctp_attestation: data.cctp_attestation,
        finalized_vaa_message_args,
    };

    let prepare_order_response_cctp_shim_ix = PrepareOrderResponseCctpShimIx {
        program_id: matching_engine_program_id,
        accounts: ix_accounts,
        data,
    }
    .instruction();

    let recent_blockhash = testing_context
        .get_new_latest_blockhash(test_context)
        .await
        .expect("Failed to get new latest blockhash");
    let transaction = Transaction::new_signed_with_payer(
        &[prepare_order_response_cctp_shim_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        recent_blockhash,
    );
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
    if expected_error.is_none() {
        Some(PrepareOrderResponseShimFixture {
            prepared_order_response: prepared_order_response_pda,
            prepared_custody_token: prepared_custody_token_pda,
            base_fee_token: accounts.base_fee_token,
        })
    } else {
        None
    }
}

pub async fn prepare_order_response_test(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    config: &PrepareOrderResponseInstructionConfig,
    current_state: &TestingEngineState,
) -> Option<PrepareOrderResponseShimFixture> {
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let deposit_vaa = current_state
        .get_test_vaa_pair(config.vaa_index)
        .deposit_vaa
        .clone();
    let deposit_vaa_data = deposit_vaa.get_vaa_data();
    let deposit = deposit_vaa
        .payload_deserialized
        .clone()
        .unwrap()
        .get_deposit()
        .unwrap();
    let core_bridge_program_id = &testing_context.get_wormhole_program_id();

    let finalized_vaa_data = current_state
        .get_test_vaa_pair(config.vaa_index)
        .get_finalized_vaa_data()
        .clone();

    let guardian_signature_info = super::verify_shim::create_guardian_signatures(
        testing_context,
        test_context,
        &payer_signer,
        &finalized_vaa_data,
        core_bridge_program_id,
        None,
    )
    .await
    .unwrap();

    let fast_market_order_state = current_state
        .fast_market_order()
        .expect("could not find fast market order")
        .fast_market_order;

    let cctp_token_burn_message = utils::cctp_message::craft_cctp_token_burn_message(
        testing_context,
        test_context,
        current_state,
        config.vaa_index,
    )
    .await
    .unwrap();
    cctp_token_burn_message
        .verify_cctp_message(&fast_market_order_state)
        .unwrap();

    let deposit_base_fee = utils::cctp_message::get_deposit_base_fee(&deposit);
    let prepare_order_response_cctp_shim_data = PrepareOrderResponseShimDataFixture::new(
        cctp_token_burn_message.encoded_cctp_burn_message,
        cctp_token_burn_message.cctp_attestation,
        deposit_vaa_data.consistency_level,
        deposit_base_fee,
        &fast_market_order_state,
        guardian_signature_info.guardian_set_bump,
    );
    let cctp_message_decoded = prepare_order_response_cctp_shim_data.decode_cctp_message();
    let prepare_order_response_cctp_shim_accounts = PrepareOrderResponseShimAccountsFixture::new(
        testing_context,
        config,
        current_state,
        &payer_signer.pubkey(),
        &cctp_message_decoded,
        &guardian_signature_info,
    );
    super::shims_prepare_order_response::prepare_order_response_cctp_shim(
        testing_context,
        test_context,
        &payer_signer,
        prepare_order_response_cctp_shim_accounts,
        prepare_order_response_cctp_shim_data,
        config.expected_error(),
    )
    .await
}

pub struct PrepareOrderResponseShimFixture {
    pub prepared_order_response: Pubkey,
    pub prepared_custody_token: Pubkey,
    pub base_fee_token: Pubkey,
}
