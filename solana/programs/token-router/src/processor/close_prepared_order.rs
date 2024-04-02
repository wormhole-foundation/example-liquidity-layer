use crate::{
    error::TokenRouterError,
    state::{Custodian, PreparedOrder},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [close_prepared_order].
#[derive(Accounts)]
pub struct ClosePreparedOrder<'info> {
    /// Custodian, but does not need to be deserialized.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: AccountInfo<'info>,

    /// This signer must be the same one encoded in the prepared order.
    order_sender: Signer<'info>,

    /// CHECK: This payer must be the same one encoded in the prepared order.
    #[account(mut)]
    prepared_by: AccountInfo<'info>,

    #[account(
        mut,
        close = prepared_by,
        has_one = prepared_by @ TokenRouterError::PreparedByMismatch,
        has_one = order_sender @ TokenRouterError::OrderSenderMismatch,
        has_one = refund_token @ TokenRouterError::RefundTokenMismatch,
    )]
    prepared_order: Account<'info, PreparedOrder>,

    /// CHECK: This account must be the same one encoded in the prepared order.
    #[account(mut)]
    refund_token: AccountInfo<'info>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order.key().as_ref(),
        ],
        bump = prepared_order.prepared_custody_token_bump,
    )]
    prepared_custody_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn close_prepared_order(ctx: Context<ClosePreparedOrder>) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.prepared_custody_token.to_account_info(),
                to: ctx.accounts.refund_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        ctx.accounts.prepared_custody_token.amount,
    )?;

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.prepared_custody_token.to_account_info(),
            destination: ctx.accounts.prepared_by.to_account_info(),
            authority: ctx.accounts.custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
