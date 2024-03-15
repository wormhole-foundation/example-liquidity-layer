use crate::{error::MatchingEngineError, processor::shared_contexts::*};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct UpdateFeeRecipient<'info> {
    admin: AdminMutCustodian<'info>,

    #[account(
        associated_token::mint = common::constants::USDC_MINT,
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
    ctx.accounts.admin.custodian.fee_recipient_token = ctx.accounts.new_fee_recipient_token.key();

    Ok(())
}
