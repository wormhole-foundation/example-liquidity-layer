use crate::state::PreparedFill;
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [consume_prepared_fill].
#[derive(Accounts)]
pub struct ConsumePreparedFill<'info> {
    /// This signer must be the same one encoded in the prepared fill.
    #[account(address = prepared_fill.redeemer)]
    redeemer: Signer<'info>,

    /// CHECK: This recipient may not necessarily be the same one encoded in the prepared fill (as
    /// the payer). If someone were to prepare a fill via a redeem fill instruction and he had no
    /// intention of consuming it, he will be out of luck. We will reward the redeemer with the
    /// closed account funds with a payer of his choosing.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    #[account(
        mut,
        close = beneficiary,
    )]
    prepared_fill: Account<'info, PreparedFill>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    dst_token: UncheckedAccount<'info>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_fill.key().as_ref(),
        ],
        bump = prepared_fill.prepared_custody_token_bump,
    )]
    prepared_custody_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn consume_prepared_fill(ctx: Context<ConsumePreparedFill>) -> Result<()> {
    let prepared_fill = &ctx.accounts.prepared_fill;

    let prepared_fill_signer_seeds = &[
        PreparedFill::SEED_PREFIX,
        prepared_fill.vaa_hash.as_ref(),
        &[prepared_fill.bump],
    ];

    let custody_token = &ctx.accounts.prepared_custody_token;
    let token_program = &ctx.accounts.token_program;

    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: custody_token.to_account_info(),
                to: ctx.accounts.dst_token.to_account_info(),
                authority: prepared_fill.to_account_info(),
            },
            &[prepared_fill_signer_seeds],
        ),
        custody_token.amount,
    )?;

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: custody_token.to_account_info(),
            destination: ctx.accounts.beneficiary.to_account_info(),
            authority: prepared_fill.to_account_info(),
        },
        &[prepared_fill_signer_seeds],
    ))
}
