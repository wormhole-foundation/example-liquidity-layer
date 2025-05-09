use crate::testing_engine::config::{InstructionConfig, PrepareOrderResponseInstructionConfig};
use crate::testing_engine::setup::{TestingContext, TransferDirection};
use crate::testing_engine::state::{OrderPreparedState, TestingEngineState};
use crate::utils;
use crate::utils::cctp_message::UsedNonces;
use anchor_lang::InstructionData;
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::spl_token;
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use matching_engine::accounts::{
    CctpMintRecipientMut, CctpReceiveMessage, CheckedCustodian, FastOrderPath, LiquidityLayerVaa,
    LiveRouterEndpoint, LiveRouterPath,
    PrepareOrderResponseCctp as PrepareOrderResponseCctpAccounts, Usdc,
};
use matching_engine::instruction::PrepareOrderResponseCctp as PrepareOrderResponseCctpIx;
use matching_engine::state::PreparedOrderResponse;
use matching_engine::CctpMessageArgs;
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use wormhole_svm_definitions::EVENT_AUTHORITY_SEED;

/// Prepare an order response (shimless)
///
/// Prepare an order response by providing a fast market order.
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `test_context` - The test context
/// * `config` - The prepare order response instruction config
/// * `current_state` - The current state
/// * `base_fee_token_address` - The base fee token address
///
/// # Returns
///
/// The new state after the prepare order response instruction is executed
pub async fn prepare_order_response(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    config: &PrepareOrderResponseInstructionConfig,
    current_state: &TestingEngineState,
) -> TestingEngineState {
    let auction_accounts = config
        .overwrite_auction_accounts
        .as_ref()
        .unwrap_or_else(|| {
            current_state
                .auction_accounts()
                .expect("Auction accounts not found")
        });

    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let (prepare_order_response_ix, order_prepared_state) =
        prepare_order_response_shimless_instruction(
            testing_context,
            test_context,
            config,
            current_state,
        )
        .await;

    let transaction = Transaction::new_signed_with_payer(
        &[prepare_order_response_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        testing_context
            .get_new_latest_blockhash(test_context)
            .await
            .expect("Failed to get new blockhash"),
    );
    let expected_error = config.expected_error();
    let expected_log_messages = config.expected_log_messages();
    if let Some(expected_log_messages) = expected_log_messages {
        testing_context
            .simulate_and_verify_logs(test_context, transaction, expected_log_messages)
            .await
            .unwrap();
    } else {
        testing_context
            .execute_and_verify_transaction(test_context, transaction, expected_error)
            .await;
    }
    if config.expected_error.is_none() {
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

/// Create the prepare order response instruction and order prepared state
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
/// The prepare order response instruction and order prepared state
pub async fn prepare_order_response_shimless_instruction(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    config: &PrepareOrderResponseInstructionConfig,
    current_state: &TestingEngineState,
) -> (Instruction, OrderPreparedState) {
    let auction_accounts = config
        .overwrite_auction_accounts
        .as_ref()
        .unwrap_or_else(|| {
            current_state
                .auction_accounts()
                .expect("Auction accounts not found")
        });
    let base_fee_token_address = config
        .actor_enum
        .get_actor(&testing_context.testing_actors)
        .token_account_address(&config.token_enum)
        .expect("Token account does not exist for solver at index");
    let to_endpoint_address = &auction_accounts.to_router_endpoint;
    let from_endpoint_address = &auction_accounts.from_router_endpoint;
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let matching_engine_program_id = &testing_context.get_matching_engine_program_id();
    let usdc_mint_address = &testing_context.get_usdc_mint_address();
    let cctp_mint_recipient = &testing_context.get_cctp_mint_recipient();
    let fixture_accounts = testing_context
        .fixture_accounts
        .clone()
        .expect("Fixture accounts not found");

    let vaa_pair = current_state.get_test_vaa_pair(config.vaa_index);
    let posted_fast_transfer_vaa = vaa_pair.clone().fast_transfer_vaa;
    let posted_fast_transfer_vaa_address = posted_fast_transfer_vaa.vaa_pubkey;
    let cctp_nonce = vaa_pair
        .deposit_vaa
        .get_payload_deserialized()
        .unwrap()
        .get_deposit()
        .unwrap()
        .cctp_nonce;
    let custodian_address = current_state
        .custodian_address()
        .expect("Custodian address not found");
    // TODO: Make checks to see if fast market order sender matches cctp message sender ...
    let cctp_token_burn_message = utils::cctp_message::craft_cctp_token_burn_message(
        testing_context,
        test_context,
        current_state,
        config.vaa_index,
    )
    .await
    .unwrap();
    let checked_custodian = CheckedCustodian {
        custodian: custodian_address,
    };
    let fast_transfer_liquidity_layer_vaa = LiquidityLayerVaa {
        vaa: posted_fast_transfer_vaa_address,
    };
    let fast_order_path = FastOrderPath {
        fast_vaa: fast_transfer_liquidity_layer_vaa,
        path: LiveRouterPath {
            to_endpoint: LiveRouterEndpoint {
                endpoint: *to_endpoint_address,
            },
            from_endpoint: LiveRouterEndpoint {
                endpoint: *from_endpoint_address,
            },
        },
    };
    let finalized_vaa = LiquidityLayerVaa {
        vaa: vaa_pair.deposit_vaa.vaa_pubkey,
    };
    let fast_transfer_digest = posted_fast_transfer_vaa.get_vaa_data().digest();
    let prepared_order_response_seeds = [
        PreparedOrderResponse::SEED_PREFIX,
        fast_transfer_digest.as_ref(),
    ];
    let (prepared_order_response_pda, _prepared_order_response_bump) =
        Pubkey::find_program_address(&prepared_order_response_seeds, matching_engine_program_id);
    let prepared_custody_token_seeds = [
        matching_engine::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
        prepared_order_response_pda.as_ref(),
    ];
    let (prepared_custody_token_pda, _prepared_custody_token_bump) =
        Pubkey::find_program_address(&prepared_custody_token_seeds, matching_engine_program_id);

    let usdc = Usdc {
        mint: *usdc_mint_address,
    };

    let remote_token_messenger = testing_context
        .get_remote_token_messenger(test_context)
        .await;

    let (used_nonces_pda, _used_nonces_bump) =
        UsedNonces::address(remote_token_messenger.domain, cctp_nonce);
    let cctp_message_transmitter_authority = Pubkey::find_program_address(
        &[
            b"message_transmitter_authority",
            &TOKEN_MESSENGER_MINTER_PROGRAM_ID.as_ref(),
        ],
        &MESSAGE_TRANSMITTER_PROGRAM_ID,
    )
    .0;
    let token_messenger_minter_event_authority =
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &TOKEN_MESSENGER_MINTER_PROGRAM_ID).0;

    let cctp_mint_recipient = CctpMintRecipientMut {
        mint_recipient: *cctp_mint_recipient,
    };
    let cctp_message_transmitter_event_authority =
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &MESSAGE_TRANSMITTER_PROGRAM_ID).0;
    let cctp_remote_token_messenger = match testing_context.transfer_direction {
        TransferDirection::FromEthereumToArbitrum => {
            fixture_accounts.ethereum_remote_token_messenger
        }
        TransferDirection::FromArbitrumToEthereum => {
            fixture_accounts.arbitrum_remote_token_messenger
        }
        _ => panic!("Unsupported transfer direction"),
    };
    let fixture_accounts = testing_context
        .fixture_accounts
        .clone()
        .expect("Fixture accounts not found");
    let message_transmitter_config_pubkey = fixture_accounts.message_transmitter_config;
    let cctp = CctpReceiveMessage {
        mint_recipient: cctp_mint_recipient,
        message_transmitter_authority: cctp_message_transmitter_authority,
        message_transmitter_config: message_transmitter_config_pubkey,
        used_nonces: used_nonces_pda,
        message_transmitter_event_authority: cctp_message_transmitter_event_authority,
        token_messenger: fixture_accounts.token_messenger,
        remote_token_messenger: cctp_remote_token_messenger,
        token_minter: fixture_accounts.token_minter,
        local_token: fixture_accounts.usdc_local_token,
        token_pair: fixture_accounts.usdc_token_pair,
        token_messenger_minter_custody_token: fixture_accounts.usdc_custody_token,
        token_messenger_minter_event_authority,
        token_messenger_minter_program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        message_transmitter_program: MESSAGE_TRANSMITTER_PROGRAM_ID,
    };
    let prepared_order_response_accounts = PrepareOrderResponseCctpAccounts {
        payer: payer_signer.pubkey(),
        custodian: checked_custodian,
        fast_order_path,
        finalized_vaa,
        prepared_order_response: prepared_order_response_pda,
        prepared_custody_token: prepared_custody_token_pda,
        base_fee_token: base_fee_token_address,
        usdc,
        cctp,
        token_program: spl_token::ID,
        system_program: system_program::ID,
    };

    let prepare_order_response_ix_data = PrepareOrderResponseCctpIx {
        args: CctpMessageArgs {
            encoded_cctp_message: cctp_token_burn_message.encoded_cctp_burn_message,
            cctp_attestation: cctp_token_burn_message.cctp_attestation,
        },
    }
    .data();

    let ix = Instruction {
        program_id: *matching_engine_program_id,
        accounts: prepared_order_response_accounts.to_account_metas(None),
        data: prepare_order_response_ix_data,
    };
    let order_prepared_state = OrderPreparedState {
        prepared_order_response_address: prepared_order_response_pda,
        prepared_custody_token: prepared_custody_token_pda,
        base_fee_token: base_fee_token_address,
        actor_enum: config.actor_enum,
    };
    (ix, order_prepared_state)
}
