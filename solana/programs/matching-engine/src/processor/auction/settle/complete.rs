use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct SettleAuctionComplete<'info> {
    /// CHECK: To prevent squatters from preparing order responses on behalf of the auction winner,
    /// we will always reward the owner of the best offer token account with the lamports from the
    /// prepared order response and its custody token account when we close these accounts. This
    /// means we disregard the `prepared_by` field in the prepared order response.
    #[account(
        mut,
        address = best_offer_token.owner,
    )]
    best_offer_authority: AccountInfo<'info>,

    #[account(
        mut,
        close = best_offer_authority,
        seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            prepared_order_response.fast_vaa_hash.as_ref()
        ],
        bump = prepared_order_response.bump,
    )]
    prepared_order_response: Account<'info, PreparedOrderResponse>,

    /// CHECK: Seeds must be \["prepared-custody"\, prepared_order_response.key()].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order_response.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: AccountInfo<'info>,

    #[account(
        seeds = [
            Auction::SEED_PREFIX,
            prepared_order_response.fast_vaa_hash.as_ref(),
        ],
        bump = auction.bump,
        constraint = {
            require!(
                matches!(auction.status, AuctionStatus::Completed { .. }),
                MatchingEngineError::AuctionNotCompleted,
            );

            true
        }
    )]
    auction: Account<'info, Auction>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(
        mut,
        address = auction.info.as_ref().unwrap().best_offer_token,
    )]
    best_offer_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
    ctx.accounts.auction.status = AuctionStatus::Settled {
        base_fee: ctx.accounts.prepared_order_response.base_fee,
        penalty: None,
    };

    let prepared_order_response_signer_seeds = &[
        PreparedOrderResponse::SEED_PREFIX,
        ctx.accounts.prepared_order_response.fast_vaa_hash.as_ref(),
        &[ctx.accounts.prepared_order_response.bump],
    ];

    // Transfer the funds back to the highest bidder.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.prepared_custody_token.to_account_info(),
                to: ctx.accounts.best_offer_token.to_account_info(),
                authority: ctx.accounts.prepared_order_response.to_account_info(),
            },
            &[prepared_order_response_signer_seeds],
        ),
        ctx.accounts.auction.info.as_ref().unwrap().amount_in,
    )?;

    // Finally close the prepared custody token account.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.prepared_custody_token.to_account_info(),
            destination: ctx.accounts.best_offer_authority.to_account_info(),
            authority: ctx.accounts.prepared_order_response.to_account_info(),
        },
        &[prepared_order_response_signer_seeds],
    ))
}
