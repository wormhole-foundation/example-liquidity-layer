use crate::{
    error::TokenRouterError,
    state::{Custodian, PreparedOrder},
    CUSTODIAN_BUMP, CUSTODY_TOKEN_BUMP,
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ClosePreparedOrder<'info> {
    /// CHECK: This payer must be the same one encoded in the prepared order.
    #[account(mut)]
    payer: AccountInfo<'info>,

    /// Custodian, but does not need to be deserialized.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = CUSTODIAN_BUMP,
    )]
    custodian: AccountInfo<'info>,

    /// This signer must be the same one encoded in the prepared order.
    order_sender: Signer<'info>,

    #[account(
        mut,
        close = payer,
        has_one = payer @ TokenRouterError::PayerMismatch,
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
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = CUSTODY_TOKEN_BUMP,
    )]
    custody_token: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
}

pub fn close_prepared_order(ctx: Context<ClosePreparedOrder>) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.refund_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[&[Custodian::SEED_PREFIX, &[CUSTODIAN_BUMP]]],
        ),
        ctx.accounts.prepared_order.amount_in,
    )
}
