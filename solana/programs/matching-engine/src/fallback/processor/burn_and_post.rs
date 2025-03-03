use common::wormhole_cctp_solana::{cctp::token_messenger_minter_program::cpi::{DepositForBurnWithCallerParams, DepositForBurnWithCaller, deposit_for_burn_with_caller}, cpi::BurnAndPublishArgs};
use solana_program::program::invoke_signed_unchecked;
use wormhole_svm_shim::post_message;
use wormhole_svm_definitions::solana::{CORE_BRIDGE_CONFIG, CORE_BRIDGE_FEE_COLLECTOR, CORE_BRIDGE_PROGRAM_ID, POST_MESSAGE_SHIM_EVENT_AUTHORITY, POST_MESSAGE_SHIM_PROGRAM_ID};
use anchor_lang::prelude::*;
use wormhole_svm_definitions::{solana::Finality, find_emitter_sequence_address, find_shim_message_address};

// This is a helper struct to make it easier to pass in the accounts for the post_message instruction.
pub struct PostMessageAccounts {
    pub emitter: Pubkey,
    pub payer: Pubkey,
    derived: PostMessageDerivedAccounts,
}

impl PostMessageAccounts {
    pub fn new(emitter: Pubkey, payer: Pubkey) -> Self {
        Self {
            emitter,
            payer,
            derived: Self::get_derived_accounts(&emitter),
        }
    }
    fn get_derived_accounts(emitter: &Pubkey) -> PostMessageDerivedAccounts {
        PostMessageDerivedAccounts {
            message: find_shim_message_address(emitter, &POST_MESSAGE_SHIM_PROGRAM_ID).0,
            sequence: find_emitter_sequence_address(emitter, &CORE_BRIDGE_PROGRAM_ID).0,
        }
    }
}

pub struct PostMessageDerivedAccounts {
    pub message: Pubkey,
    pub sequence: Pubkey,
}

pub fn burn_and_post<'info>(
    cctp_ctx: CpiContext<'_, '_, '_, 'info, DepositForBurnWithCaller<'info>>,
    burn_and_publish_args: BurnAndPublishArgs, post_message_accounts: PostMessageAccounts,
    account_infos: &[AccountInfo]) -> Result<()> {
    let BurnAndPublishArgs {
        burn_source: _,
        destination_caller,
        destination_cctp_domain,
        amount,
        mint_recipient,
        wormhole_message_nonce,
        payload,
    } = burn_and_publish_args;

    let post_message_ix = post_message::PostMessage {
        program_id: &POST_MESSAGE_SHIM_PROGRAM_ID,
        accounts: post_message::PostMessageAccounts {
            emitter: &post_message_accounts.emitter,
            payer: &post_message_accounts.payer,
            wormhole_program_id: &CORE_BRIDGE_PROGRAM_ID,
            derived: post_message::PostMessageDerivedAccounts {
                message: Some(&post_message_accounts.derived.message),
                sequence: Some(&post_message_accounts.derived.sequence),
                core_bridge_config: Some(&CORE_BRIDGE_CONFIG),
                fee_collector: Some(&CORE_BRIDGE_FEE_COLLECTOR),
                event_authority: Some(&POST_MESSAGE_SHIM_EVENT_AUTHORITY),
            },
        },
        data: post_message::PostMessageData::new(
            wormhole_message_nonce,
            Finality::Finalized,
            &payload,
        )
        .unwrap(),
    }
    .instruction();

    invoke_signed_unchecked(&post_message_ix, account_infos, &[])?;

    deposit_for_burn_with_caller(
        cctp_ctx,
        DepositForBurnWithCallerParams {
            amount,
            destination_domain: destination_cctp_domain,
            mint_recipient,
            destination_caller,
        },
    )?;
    Ok(())
}
