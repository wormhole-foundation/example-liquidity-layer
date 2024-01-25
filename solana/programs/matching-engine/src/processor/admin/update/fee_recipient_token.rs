use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::admin::utils::assistant::only_authorized;

#[derive(Accounts)]
pub struct UpdateFeeRecipient<'info> {
    #[account(
        mut,
        constraint = {
            only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        associated_token::mint = common::constants::usdc::id(),
        associated_token::authority = new_fee_recipient,
    )]
    new_fee_recipient_token: Account<'info, token::TokenAccount>,

    /// New Fee Recipient.
    ///
    /// CHECK: Must not be zero pubkey.
    #[account(
        constraint = {
            new_fee_recipient.key() != Pubkey::default()
        } @ MatchingEngineError::FeeRecipientZeroPubkey,
    )]
    new_fee_recipient: AccountInfo<'info>,
}

pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
    // Update the fee_recipient key.
    ctx.accounts.custodian.fee_recipient_token = ctx.accounts.new_fee_recipient_token.key();

    Ok(())
}
