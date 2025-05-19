use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use matching_engine::{
    fallback::settle_auction_none_cctp::{
        SettleAuctionNoneCctpShim, SettleAuctionNoneCctpShimAccounts, SettleAuctionNoneCctpShimData,
    },
    state::Auction,
};
use solana_program_test::ProgramTestContext;
use solana_sdk::{signature::Signer, sysvar::SysvarId, transaction::Transaction};
use wormhole_svm_definitions::solana::{
    CORE_BRIDGE_PROGRAM_ID, POST_MESSAGE_SHIM_EVENT_AUTHORITY, POST_MESSAGE_SHIM_PROGRAM_ID,
};

use crate::{
    testing_engine::{
        config::{InstructionConfig, SettleAuctionNoneInstructionConfig},
        setup::TestingContext,
        state::{OrderPreparedState, TestingEngineState},
    },
    utils::{
        auction::AuctionState, token_account::SplTokenEnum, CORE_BRIDGE_CONFIG,
        CORE_BRIDGE_FEE_COLLECTOR,
    },
};

use super::shims_execute_order::{create_cctp_accounts, CctpAccounts};

pub async fn settle_auction_none_shimful(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &SettleAuctionNoneInstructionConfig,
) -> AuctionState {
    let payer_signer = &config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let settle_auction_none_cctp_accounts =
        create_settle_auction_none_cctp_shimful_accounts(testing_context, current_state, config);
    let settle_auction_none_cctp_data = settle_auction_none_cctp_accounts.bumps;

    let settle_auction_none_cctp_ix = SettleAuctionNoneCctpShim {
        program_id: &testing_context.get_matching_engine_program_id(),
        accounts: settle_auction_none_cctp_accounts.as_ref(),
        data: settle_auction_none_cctp_data,
    }
    .instruction();
    let last_blockhash = test_context.get_new_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[settle_auction_none_cctp_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        last_blockhash,
    );
    testing_context
        .execute_and_verify_transaction(test_context, tx, config.expected_error())
        .await;
    if config.expected_error().is_some() {
        return current_state.auction_state().clone();
    }

    AuctionState::Settled(None)
}

struct SettleAuctionNoneCctpShimAccountsOwned {
    pub payer: Pubkey,
    pub post_message_message: Pubkey,
    pub post_message_sequence: Pubkey,
    pub post_message_shim_event_authority: Pubkey,
    pub post_message_shim_program: Pubkey,
    pub cctp_message: Pubkey,
    pub custodian: Pubkey,
    pub fee_recipient_token: Pubkey,
    pub closed_prepared_order_response_actor: Pubkey,
    pub closed_prepared_order_response: Pubkey,
    pub closed_prepared_order_response_custody_token: Pubkey,
    pub auction: Pubkey,
    pub cctp_mint: Pubkey,
    pub cctp_local_token: Pubkey,
    pub cctp_token_messenger_minter_event_authority: Pubkey,
    pub cctp_remote_token_messenger: Pubkey,
    pub cctp_token_messenger: Pubkey,
    pub cctp_token_messenger_minter_sender_authority: Pubkey,
    pub cctp_token_minter: Pubkey,
    pub cctp_token_messenger_minter_program: Pubkey,
    pub cctp_message_transmitter_config: Pubkey,
    pub cctp_message_transmitter_program: Pubkey,
    pub core_bridge_program: Pubkey,
    pub core_bridge_fee_collector: Pubkey,
    pub core_bridge_config: Pubkey,
    pub token_program: Pubkey,
    pub system_program: Pubkey,
    pub clock: Pubkey,
    pub rent: Pubkey,
    pub bumps: SettleAuctionNoneCctpShimData,
}

impl SettleAuctionNoneCctpShimAccountsOwned {
    pub fn as_ref(&self) -> SettleAuctionNoneCctpShimAccounts {
        SettleAuctionNoneCctpShimAccounts {
            payer: &self.payer,
            post_shim_message: &self.post_message_message,
            core_bridge_emitter_sequence: &self.post_message_sequence,
            post_message_shim_event_authority: &self.post_message_shim_event_authority,
            post_message_shim_program: &self.post_message_shim_program,
            cctp_message: &self.cctp_message,
            custodian: &self.custodian,
            fee_recipient_token: &self.fee_recipient_token,
            closed_prepared_order_response_actor: &self.closed_prepared_order_response_actor,
            closed_prepared_order_response: &self.closed_prepared_order_response,
            closed_prepared_order_response_custody_token: &self
                .closed_prepared_order_response_custody_token,
            auction: &self.auction,
            cctp_mint: &self.cctp_mint,
            cctp_local_token: &self.cctp_local_token,
            cctp_token_messenger_minter_event_authority: &self
                .cctp_token_messenger_minter_event_authority,
            cctp_remote_token_messenger: &self.cctp_remote_token_messenger,
            cctp_token_messenger: &self.cctp_token_messenger,
            cctp_token_messenger_minter_sender_authority: &self
                .cctp_token_messenger_minter_sender_authority,
            cctp_token_minter: &self.cctp_token_minter,
            cctp_token_messenger_minter_program: &self.cctp_token_messenger_minter_program,
            cctp_message_transmitter_config: &self.cctp_message_transmitter_config,
            cctp_message_transmitter_program: &self.cctp_message_transmitter_program,
            core_bridge_program: &self.core_bridge_program,
            core_bridge_fee_collector: &self.core_bridge_fee_collector,
            core_bridge_config: &self.core_bridge_config,
            token_program: &self.token_program,
            system_program: &self.system_program,
            clock: &self.clock,
            rent: &self.rent,
        }
    }
}

fn create_settle_auction_none_cctp_shimful_accounts(
    testing_context: &TestingContext,
    current_state: &TestingEngineState,
    config: &SettleAuctionNoneInstructionConfig,
) -> SettleAuctionNoneCctpShimAccountsOwned {
    let payer_signer = &config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());

    let order_prepared_state = current_state.order_prepared().unwrap();
    let OrderPreparedState {
        prepared_order_response_address,
        prepared_custody_token,
        base_fee_token: _,
        actor_enum: _,
        prepared_by,
    } = *order_prepared_state;

    let custodian = current_state
        .custodian_address()
        .expect("Custodian address not found");
    println!("Settle auction custodian address: {:?}", custodian);

    let fast_market_order = current_state.fast_market_order().unwrap().fast_market_order;
    let fast_vaa_hash = fast_market_order.digest();
    let (auction, auction_bump) = Pubkey::find_program_address(
        &[Auction::SEED_PREFIX, fast_vaa_hash.as_ref()],
        &testing_context.get_matching_engine_program_id(),
    );

    let (cctp_message, cctp_message_bump) = Pubkey::find_program_address(
        &[common::CCTP_MESSAGE_SEED_PREFIX, &auction.to_bytes()],
        &testing_context.get_matching_engine_program_id(),
    );

    let post_message_sequence = wormhole_svm_definitions::find_emitter_sequence_address(
        &custodian,
        &CORE_BRIDGE_PROGRAM_ID,
    )
    .0;
    let post_message_message = wormhole_svm_definitions::find_shim_message_address(
        &custodian,
        &POST_MESSAGE_SHIM_PROGRAM_ID,
    )
    .0;

    let fee_recipient_token = testing_context
        .testing_actors
        .fee_recipient
        .token_account_address(&SplTokenEnum::Usdc)
        .unwrap();

    let CctpAccounts {
        mint,
        local_token,
        token_messenger_minter_event_authority,
        remote_token_messenger,
        token_messenger,
        token_messenger_minter_sender_authority,
        token_minter,
        token_messenger_minter_program,
        message_transmitter_config,
        message_transmitter_program,
    } = create_cctp_accounts(current_state, testing_context);
    SettleAuctionNoneCctpShimAccountsOwned {
        payer: payer_signer.pubkey(),
        post_message_message,
        post_message_sequence,
        post_message_shim_event_authority: POST_MESSAGE_SHIM_EVENT_AUTHORITY,
        post_message_shim_program: POST_MESSAGE_SHIM_PROGRAM_ID,
        cctp_message,
        custodian,
        fee_recipient_token,
        closed_prepared_order_response_actor: prepared_by,
        closed_prepared_order_response: prepared_order_response_address,
        closed_prepared_order_response_custody_token: prepared_custody_token,
        auction,
        cctp_mint: mint,
        cctp_local_token: local_token,
        cctp_token_messenger_minter_event_authority: token_messenger_minter_event_authority,
        cctp_remote_token_messenger: remote_token_messenger,
        cctp_token_messenger: token_messenger,
        cctp_token_messenger_minter_sender_authority: token_messenger_minter_sender_authority,
        cctp_token_minter: token_minter,
        cctp_token_messenger_minter_program: token_messenger_minter_program,
        cctp_message_transmitter_config: message_transmitter_config,
        cctp_message_transmitter_program: message_transmitter_program,
        core_bridge_program: CORE_BRIDGE_PROGRAM_ID,
        core_bridge_fee_collector: CORE_BRIDGE_FEE_COLLECTOR,
        core_bridge_config: CORE_BRIDGE_CONFIG,
        token_program: spl_token::ID,
        system_program: solana_program::system_program::ID,
        clock: solana_program::clock::Clock::id(),
        rent: solana_program::rent::Rent::id(),
        bumps: SettleAuctionNoneCctpShimData {
            cctp_message_bump,
            auction_bump,
        },
    }
}
