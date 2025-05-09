use crate::testing_engine::config::{InstructionConfig, PrepareOrderResponseInstructionConfig};
use crate::testing_engine::setup::{TestingContext, TransferDirection};
use crate::testing_engine::state::{OrderPreparedState, TestingEngineState};

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
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use utils::cctp_message::{CctpMessageDecoded, UsedNonces};
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

/// Prepare order response cctp shimful
///
/// Executes the prepare order response instruction in a testing context
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The test context
/// * `config` - The prepare order response instruction config
/// * `current_state` - The current state
///
/// # Returns
///
/// The prepare order response shim fixture (none if failed)
pub async fn prepare_order_response_cctp_shimful(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    config: &PrepareOrderResponseInstructionConfig,
    current_state: &TestingEngineState,
) -> TestingEngineState {
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let data = PrepareOrderResponseShimDataHelper::new(
        testing_context,
        test_context,
        current_state,
        config,
    )
    .await;
    let cctp_message_decoded = data.decode_cctp_message();
    let accounts = PrepareOrderResponseShimAccountsHelper::new(
        testing_context,
        config,
        current_state,
        &cctp_message_decoded,
        &data,
    );

    let ix_accounts = PrepareOrderResponseCctpShimAccounts {
        signer: &accounts.signer,
        custodian: &accounts.custodian,
        fast_market_order: &accounts.fast_market_order,
        from_endpoint: &accounts.from_endpoint,
        to_endpoint: &accounts.to_endpoint,
        prepared_order_response: &accounts.prepared_order_response,
        prepared_custody_token: &accounts.prepared_custody_token,
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
    let program_id = &testing_context.get_matching_engine_program_id();
    let prepare_order_response_cctp_shim_ix = PrepareOrderResponseCctpShimIx {
        program_id,
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

    let expected_error = config.expected_error();
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
    if config.expected_error.is_none() {
        let auction_accounts = config
            .overwrite_auction_accounts
            .as_ref()
            .unwrap_or_else(|| {
                current_state
                    .auction_accounts()
                    .expect("Auction accounts not found")
            });

        let order_prepared_state = OrderPreparedState {
            prepared_order_response_address: accounts.prepared_order_response,
            prepared_custody_token: accounts.prepared_custody_token,
            base_fee_token: accounts.base_fee_token,
            actor_enum: config.actor_enum,
        };
        TestingEngineState::OrderPrepared {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().unwrap().clone(),
            fast_market_order: current_state.fast_market_order().cloned(),
            auction_state: current_state.auction_state().clone(),
            order_prepared: order_prepared_state,
            auction_accounts: auction_accounts.clone(),
        }
    } else {
        current_state.clone()
    }
}

/// Prepare order response shim data helper
///
/// This struct is a helper struct used to create the data for the prepare order response instruction
///
/// # Fields
///
/// * `encoded_cctp_message` - The encoded CCTP message
/// * `cctp_attestation` - The CCTP attestation
/// * `finalized_vaa_message_args` - The finalized VAA message args
/// * `fast_market_order` - The fast market order
struct PrepareOrderResponseShimDataHelper {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message_args: FinalizedVaaMessageArgs,
    pub fast_market_order: FastMarketOrderState,
    pub guardian_signature_info: GuardianSignatureInfo,
}

/// A helper struct for the data for the prepare order response shimful instruction that disregards the lifetime
impl PrepareOrderResponseShimDataHelper {
    /// Create a new prepare order response shim data helper
    ///
    /// # Arguments
    ///
    /// * `encoded_cctp_message` - The encoded CCTP message
    /// * `cctp_attestation` - The CCTP attestation
    /// * `consistency_level` - The consistency level
    /// * `base_fee` - The base fee
    /// * `fast_market_order` - The fast market order
    /// * `guardian_set_bump` - The guardian set bump
    ///
    /// # Returns
    ///
    /// The prepare order response shim data helper
    pub async fn new(
        testing_context: &TestingContext,
        test_context: &mut ProgramTestContext,
        current_state: &TestingEngineState,
        config: &PrepareOrderResponseInstructionConfig,
    ) -> Self {
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
        let finalized_vaa_data = current_state
            .get_test_vaa_pair(config.vaa_index)
            .get_finalized_vaa_data()
            .clone();

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

        let core_bridge_program_id = &testing_context.get_wormhole_program_id();

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

        Self {
            encoded_cctp_message: cctp_token_burn_message.encoded_cctp_burn_message,
            cctp_attestation: cctp_token_burn_message.cctp_attestation,
            finalized_vaa_message_args: FinalizedVaaMessageArgs {
                consistency_level: deposit_vaa_data.consistency_level,
                base_fee: deposit_base_fee,
                guardian_set_bump: guardian_signature_info.guardian_set_bump,
            },
            fast_market_order: fast_market_order_state,
            guardian_signature_info,
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

/// Prepare order response shim accounts helper
///
/// A helper struct for the accounts for the prepare order response shimful instruction that disregards the lifetime
///
/// Fields are equivalent to the PrepareOrderResponseCctpShimAccounts struct
struct PrepareOrderResponseShimAccountsHelper {
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
    pub prepared_order_response: Pubkey,
    pub prepared_custody_token: Pubkey,
}

impl PrepareOrderResponseShimAccountsHelper {
    /// Create a new prepare order response shim accounts helper
    ///
    /// # Arguments
    ///
    /// * `testing_context` - The testing context
    /// * `config` - The prepare order response instruction config
    /// * `current_state` - The current state
    /// * `cctp_message_decoded` - The CCTP message decoded
    /// * `data` - The prepare order response shim data helper
    pub fn new(
        testing_context: &TestingContext,
        config: &PrepareOrderResponseInstructionConfig,
        current_state: &TestingEngineState,
        cctp_message_decoded: &CctpMessageDecoded,
        data: &PrepareOrderResponseShimDataHelper,
    ) -> Self {
        let guardian_signature_info = &data.guardian_signature_info;
        let signer = &config
            .payer_signer
            .clone()
            .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
        let usdc_mint_address = testing_context.get_usdc_mint_address();
        let auction_accounts = config
            .overwrite_auction_accounts
            .as_ref()
            .unwrap_or_else(|| {
                current_state
                    .auction_accounts()
                    .expect("Auction accounts not found")
            });
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
        let matching_engine_program_id = &testing_context.get_matching_engine_program_id();
        let fast_market_order_digest = data.fast_market_order.digest();
        let prepared_order_response_seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            &fast_market_order_digest,
        ];

        let (prepared_order_response_pda, _prepared_order_response_bump) =
            Pubkey::find_program_address(
                &prepared_order_response_seeds,
                matching_engine_program_id,
            );

        let prepared_custody_token_seeds = [
            matching_engine::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order_response_pda.as_ref(),
        ];
        let (prepared_custody_token_pda, _prepared_custody_token_bump) =
            Pubkey::find_program_address(&prepared_custody_token_seeds, matching_engine_program_id);
        Self {
            signer: signer.pubkey(),
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
            prepared_order_response: prepared_order_response_pda,
            prepared_custody_token: prepared_custody_token_pda,
        }
    }
}
