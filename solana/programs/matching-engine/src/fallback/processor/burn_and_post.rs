use crate::state::Custodian;
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::{
    cctp::token_messenger_minter_program::cpi::{
        deposit_for_burn_with_caller, DepositForBurnWithCaller, DepositForBurnWithCallerParams,
    },
    cpi::BurnAndPublishArgs,
};
use solana_program::program::invoke_signed_unchecked;
use wormhole_svm_definitions::solana::Finality;
use wormhole_svm_definitions::solana::{
    CORE_BRIDGE_CONFIG, CORE_BRIDGE_FEE_COLLECTOR, CORE_BRIDGE_PROGRAM_ID,
    POST_MESSAGE_SHIM_EVENT_AUTHORITY, POST_MESSAGE_SHIM_PROGRAM_ID,
};
use wormhole_svm_shim::post_message;

// This is a helper struct to make it easier to pass in the accounts for the post_message instruction.
pub struct PostMessageAccounts<'ix> {
    pub emitter: &'ix Pubkey,
    pub payer: &'ix Pubkey,
    pub message: &'ix Pubkey,
    pub sequence: &'ix Pubkey,
}

pub fn burn_and_post<'info>(
    cctp_ctx: CpiContext<'_, '_, '_, 'info, DepositForBurnWithCaller<'info>>,
    burn_and_publish_args: BurnAndPublishArgs,
    post_message_accounts: PostMessageAccounts,
    account_infos: &[AccountInfo],
) -> Result<()> {
    let BurnAndPublishArgs {
        burn_source: _,
        destination_caller,
        destination_cctp_domain,
        amount,
        mint_recipient,
        wormhole_message_nonce,
        payload,
    } = burn_and_publish_args;

    let PostMessageAccounts {
        emitter,
        payer,
        message,
        sequence,
    } = post_message_accounts;

    // Post message to the shim program
    let post_message_ix = post_message::PostMessage {
        program_id: &POST_MESSAGE_SHIM_PROGRAM_ID,
        accounts: post_message::PostMessageAccounts {
            emitter,
            payer,
            wormhole_program_id: &CORE_BRIDGE_PROGRAM_ID,
            derived: post_message::PostMessageDerivedAccounts {
                message: Some(&message),
                sequence: Some(&sequence),
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

    invoke_signed_unchecked(&post_message_ix, account_infos, &[Custodian::SIGNER_SEEDS])?;

    // Deposit for burn
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
