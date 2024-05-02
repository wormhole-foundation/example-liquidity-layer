use crate::{
    composite::*,
    state::{Auction, Custodian, FastFill},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [settle_auction_none_local].
#[event_cpi]
#[derive(Accounts)]
pub struct SettleAuctionNoneLocal<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(
        mut,
        address = custodian.fee_recipient_token,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    prepared: ClosePreparedOrderResponse<'info>,

    /// There should be no account data here because an auction was never created.
    #[account(
        init,
        payer = payer,
        space = 8 + Auction::INIT_SPACE_NO_AUCTION,
        seeds = [
            Auction::SEED_PREFIX,
            prepared.order_response.fast_vaa_hash.as_ref(),
        ],
        bump,
    )]
    auction: Box<Account<'info, Auction>>,

    #[account(
        init,
        payer = payer,
        space = FastFill::checked_compute_size(prepared.order_response.redeemer_message.len()).unwrap(),
        seeds = [
            FastFill::SEED_PREFIX,
            auction.key().as_ref(),
        ],
        bump,
    )]
    fast_fill: Account<'info, FastFill>,

    #[account(
        mut,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            &prepared.order_response.source_chain.to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    sysvars: RequiredSysvars<'info>,
}

pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
    let prepared_by = &ctx.accounts.prepared.by;
    let prepared_custody_token = &ctx.accounts.prepared.custody_token;
    let custodian = &ctx.accounts.custodian;
    let token_program = &ctx.accounts.token_program;

    let super::SettledNone {
        user_amount: amount,
        fill,
    } = super::settle_none_and_prepare_fill(
        super::SettleNoneAndPrepareFill {
            prepared_order_response: &mut ctx.accounts.prepared.order_response,
            prepared_custody_token,
            auction: &mut ctx.accounts.auction,
            fee_recipient_token: &ctx.accounts.fee_recipient_token,
            custodian,
            token_program,
        },
        ctx.bumps.auction,
    )?;

    let fast_fill = FastFill::new(ctx.bumps.fast_fill, ctx.accounts.payer.key(), amount, fill);
    emit_cpi!(crate::events::FilledLocalFastOrder {
        fast_fill: ctx.accounts.fast_fill.key(),
        info: fast_fill.info,
        redeemer_message: fast_fill.redeemer_message.clone(),
    });
    ctx.accounts.fast_fill.set_inner(fast_fill);

    // Transfer funds to the local custody account.
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: prepared_custody_token.to_account_info(),
                to: ctx.accounts.local_custody_token.to_account_info(),
                authority: custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount,
    )?;

    // Finally close the account since it is no longer needed.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: prepared_custody_token.to_account_info(),
            destination: prepared_by.to_account_info(),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
