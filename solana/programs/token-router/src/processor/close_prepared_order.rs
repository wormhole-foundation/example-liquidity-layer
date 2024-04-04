use crate::{
    composite::*,
    state::{Custodian, PreparedOrder},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [close_prepared_order].
#[derive(Accounts)]
pub struct ClosePreparedOrder<'info> {
    custodian: CheckedCustodian<'info>,

    /// This signer must be the same one encoded in the prepared order.
    #[account(address = prepared_order.order_sender)]
    order_sender: Signer<'info>,

    #[account(
        mut,
        close = prepared_by,
    )]
    prepared_order: Account<'info, PreparedOrder>,

    /// CHECK: This payer must be the same one encoded in the prepared order.
    #[account(
        mut,
        address = prepared_order.prepared_by,
    )]
    prepared_by: AccountInfo<'info>,

    /// CHECK: This account must be the same one encoded in the prepared order.
    #[account(
        mut,
        address = prepared_order.refund_token,
    )]
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
