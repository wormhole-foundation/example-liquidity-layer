use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct SettleAuctionComplete<'info> {
    /// CHECK: To prevent squatters from preparing order responses on behalf of the auction winner,
    /// we will always reward the owner of the executor token account with the lamports from the
    /// prepared order response and its custody token account when we close these accounts. This
    /// means we disregard the `prepared_by` field in the prepared order response.
    #[account(mut)]
    executor: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = best_offer_token.mint,
        associated_token::authority = executor,
    )]
    executor_token: Account<'info, token::TokenAccount>,

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

    #[account(
        mut,
        close = executor,
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
        mut,
        seeds = [
            Auction::SEED_PREFIX,
            prepared_order_response.fast_vaa_hash.as_ref(),
        ],
        bump = auction.bump,
    )]
    auction: Account<'info, Auction>,

    token_program: Program<'info, token::Token>,
}

pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
    match ctx.accounts.auction.status {
        AuctionStatus::Completed {
            slot: _,
            execute_penalty,
        } => handle_settle_auction_complete(ctx, execute_penalty),
        _ => err!(MatchingEngineError::AuctionNotCompleted),
    }
}

fn handle_settle_auction_complete(
    ctx: Context<SettleAuctionComplete>,
    execute_penalty: Option<u64>,
) -> Result<()> {
    let prepared_order_response = &ctx.accounts.prepared_order_response;
    let base_fee = prepared_order_response.base_fee;

    ctx.accounts.auction.status = AuctionStatus::Settled {
        base_fee,
        total_penalty: execute_penalty.map(|v| v.saturating_add(base_fee)),
    };

    let executor_token = &ctx.accounts.executor_token;
    let best_offer_token = &ctx.accounts.best_offer_token;
    let prepared_custody_token = &ctx.accounts.prepared_custody_token;
    let token_program = &ctx.accounts.token_program;

    let prepared_order_response_signer_seeds = &[
        PreparedOrderResponse::SEED_PREFIX,
        prepared_order_response.fast_vaa_hash.as_ref(),
        &[prepared_order_response.bump],
    ];

    // We may deduct from this account if the winning participant was penalized.
    let mut repayment = ctx.accounts.auction.info.as_ref().unwrap().amount_in;

    match execute_penalty {
        None => {
            // If there is no penalty, we require that the executor token and best offer token be
            // equal. The winning offer should not be penalized for calling this instruction when he
            // has executed the order within the grace period.
            //
            // By requiring that these pubkeys are equal, we enforce that the owner of the best
            // offer token gets rewarded the lamports from the prepared order response and its
            // custody account.
            require_keys_eq!(
                executor_token.key(),
                best_offer_token.key(),
                MatchingEngineError::ExecutorTokenMismatch
            )
        }
        _ => {
            if executor_token.key() != best_offer_token.key() {
                // Because the auction participant was penalized for executing the order late, he
                // will be deducted the base fee. This base fee will be sent to the executor token
                // account if it is not the same as the best offer token account.
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program.to_account_info(),
                        token::Transfer {
                            from: prepared_custody_token.to_account_info(),
                            to: executor_token.to_account_info(),
                            authority: prepared_order_response.to_account_info(),
                        },
                        &[prepared_order_response_signer_seeds],
                    ),
                    base_fee,
                )?;

                repayment = repayment.saturating_sub(base_fee);
            }
        }
    };

    // Transfer the funds back to the highest bidder.
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: prepared_custody_token.to_account_info(),
                to: best_offer_token.to_account_info(),
                authority: prepared_order_response.to_account_info(),
            },
            &[prepared_order_response_signer_seeds],
        ),
        repayment,
    )?;

    emit!(crate::events::AuctionSettled {
        auction: ctx.accounts.auction.key(),
        best_offer_token: Some(best_offer_token.key()),
        token_balance_after: best_offer_token.amount.saturating_add(repayment),
    });

    // Finally close the prepared custody token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: prepared_custody_token.to_account_info(),
            destination: ctx.accounts.executor.to_account_info(),
            authority: prepared_order_response.to_account_info(),
        },
        &[prepared_order_response_signer_seeds],
    ))
}
