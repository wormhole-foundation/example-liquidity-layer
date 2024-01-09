use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use ownable_tools::utils::assistant::only_authorized;

#[derive(Accounts)]
pub struct UpdateFeeRecipient<'info> {
    #[account(
        mut,
        constraint = only_authorized(&custodian, &owner_or_assistant.key()) @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// New Fee Recipient.
    ///
    /// CHECK: Must not be zero pubkey.
    #[account(
        constraint = new_fee_recipient.key() != Pubkey::default() @ MatchingEngineError::FeeRecipientZeroPubkey,
    )]
    new_fee_recipient: AccountInfo<'info>,
}

pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
    // require_keys_neq!(
    //     new_fee_recipient,
    //     ctx.accounts.custodian.fee_recipient,
    //     MatchingEngineError::AlreadyTheFeeRecipient
    // );

    // Update the fee_recipient key.
    ctx.accounts.custodian.fee_recipient = ctx.accounts.new_fee_recipient.key();

    Ok(())
}
