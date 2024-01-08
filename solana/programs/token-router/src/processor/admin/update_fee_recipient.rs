use crate::{
    error::MatchingEngineError,
    state::Custodian,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateFeeRecipient<'info> {
    #[account(
        mut,
        constraint = super::require_owner_or_assistant(&custodian, &owner_or_assistant)?,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    system_program: Program<'info, System>,
}

pub fn update_fee_recipient(
    ctx: Context<UpdateFeeRecipient>,
    new_fee_recipient: Pubkey,
) -> Result<()> {
    require_keys_neq!(
        new_fee_recipient,
        Pubkey::default(),
        MatchingEngineError::FeeRecipientZeroPubkey
    );
    require_keys_neq!(
        new_fee_recipient,
        ctx.accounts.custodian.fee_recipient,
        TokenBridgeRelayerError::AlreadyTheFeeRecipient
    );

    // Update the fee_recipient key.
    let custodian = &mut ctx.accounts.custodian;
    custodian.fee_recipient = new_fee_recipient;

    Ok(())
}