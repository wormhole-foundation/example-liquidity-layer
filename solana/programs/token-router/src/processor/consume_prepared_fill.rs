use crate::{
    error::TokenRouterError,
    state::{Custodian, PreparedFill},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [consume_prepared_fill].
#[derive(Accounts)]
pub struct ConsumePreparedFill<'info> {
    /// Custodian, but does not need to be deserialized.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: AccountInfo<'info>,

    /// This signer must be the same one encoded in the prepared fill.
    redeemer: Signer<'info>,

    /// CHECK: This recipient may not necessarily be the same one encoded in the prepared fill (as
    /// the payer). If someone were to prepare a fill via a redeem fill instruction and he had no
    /// intention of consuming it, he will be out of luck. We will reward the redeemer with the
    /// closed account funds with a payer of his choosing.
    #[account(mut)]
    rent_recipient: AccountInfo<'info>,

    #[account(
        mut,
        close = rent_recipient,
        has_one = redeemer @ TokenRouterError::RedeemerMismatch,
    )]
    prepared_fill: Account<'info, PreparedFill>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    dst_token: AccountInfo<'info>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        address = crate::custody_token::id() @ TokenRouterError::InvalidCustodyToken,
    )]
    custody_token: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
}

/// TODO: add docstring
pub fn consume_prepared_fill(ctx: Context<ConsumePreparedFill>) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.dst_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        ctx.accounts.prepared_fill.amount,
    )
}
