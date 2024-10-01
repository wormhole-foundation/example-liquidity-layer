use crate::{
    error::MatchingEngineError,
    events::SettledTokenAccountInfo,
    state::{Auction, AuctionStatus, PreparedOrderResponse},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount};

#[derive(Accounts)]
#[event_cpi]
pub struct SettleAuctionComplete<'info> {
    /// CHECK: Must equal prepared_order_response.prepared_by, who paid the rent to post the
    /// finalized VAA.
    #[account(
        mut,
        address = prepared_order_response.prepared_by,
    )]
    beneficiary: UncheckedAccount<'info>,

    /// This token account will receive the base fee only if there was a penalty when executing the
    /// order. If it does not exist when there is a penalty, this instruction handler will revert.
    ///
    /// CHECK: This account must be the same as the base fee token in the prepared order response.
    #[account(
        mut,
        address = prepared_order_response.base_fee_token,
    )]
    base_fee_token: UncheckedAccount<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account may exist. If it doesn't and there is a penalty, we will send all
    /// of the tokens to the base fee token account.
    #[account(
        mut,
        address = auction.info.as_ref().unwrap().best_offer_token,
    )]
    best_offer_token: UncheckedAccount<'info>,

    #[account(
        mut,
        close = beneficiary,
        seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            prepared_order_response.seeds.fast_vaa_hash.as_ref()
        ],
        bump = prepared_order_response.seeds.bump,
    )]
    prepared_order_response: Box<Account<'info, PreparedOrderResponse>>,

    /// CHECK: Seeds must be \["prepared-custody"\, prepared_order_response.key()].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order_response.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            Auction::SEED_PREFIX,
            prepared_order_response.seeds.fast_vaa_hash.as_ref(),
        ],
        bump = auction.bump,
    )]
    auction: Box<Account<'info, Auction>>,

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
        fee: base_fee,
        total_penalty: execute_penalty.map(|v| v.saturating_add(base_fee)),
    };

    let prepared_order_response_signer_seeds = &[
        PreparedOrderResponse::SEED_PREFIX,
        prepared_order_response.seeds.fast_vaa_hash.as_ref(),
        &[prepared_order_response.seeds.bump],
    ];

    let beneficiary = &ctx.accounts.beneficiary;
    let base_fee_token = &ctx.accounts.base_fee_token;
    let best_offer_token = &ctx.accounts.best_offer_token;
    let token_program = &ctx.accounts.token_program;
    let prepared_custody_token = &ctx.accounts.prepared_custody_token;

    let repayment = ctx.accounts.prepared_custody_token.amount;

    struct TokenAccountResult {
        balance_before: u64,
        amount: u64,
    }

    let (base_fee_result, best_offer_result) = match execute_penalty {
        // When there is no penalty, we will give everything to the best offer token account.
        None => {
            // If the token account happens to not exist anymore, we will revert.
            let best_offer_token_data =
                utils::checked_deserialize_token_account(best_offer_token, &common::USDC_MINT)
                    .ok_or_else(|| MatchingEngineError::BestOfferTokenRequired)?;

            (
                None, // base_fee_result
                TokenAccountResult {
                    balance_before: best_offer_token_data.amount,
                    amount: repayment,
                }
                .into(),
            )
        }
        // Otherwise, determine how the repayment should be divvied up.
        _ => {
            match (
                utils::checked_deserialize_token_account(base_fee_token, &common::USDC_MINT),
                utils::checked_deserialize_token_account(best_offer_token, &common::USDC_MINT),
            ) {
                (Some(base_fee_token_data), Some(best_offer_token_data)) => {
                    if base_fee_token.key() == best_offer_token.key() {
                        (
                            None, // base_fee_result
                            TokenAccountResult {
                                balance_before: best_offer_token_data.amount,
                                amount: repayment,
                            }
                            .into(),
                        )
                    } else {
                        (
                            TokenAccountResult {
                                balance_before: base_fee_token_data.amount,
                                amount: base_fee,
                            }
                            .into(),
                            TokenAccountResult {
                                balance_before: best_offer_token_data.amount,
                                amount: repayment.saturating_sub(base_fee),
                            }
                            .into(),
                        )
                    }
                }
                // If the best offer token account does not exist, we will give everything to the
                // base fee token account.
                (Some(base_fee_token_data), None) => (
                    TokenAccountResult {
                        balance_before: base_fee_token_data.amount,
                        amount: repayment,
                    }
                    .into(),
                    None, // best_offer_result
                ),
                // If the base fee token account does not exist, we will give everything to the best
                // offer token account.
                (None, Some(best_offer_data)) => {
                    (
                        None, // base_fee_result
                        TokenAccountResult {
                            balance_before: best_offer_data.amount,
                            amount: repayment,
                        }
                        .into(),
                    )
                }
                // Otherwise revert.
                _ => return err!(MatchingEngineError::BestOfferTokenRequired),
            }
        }
    };

    // Transfer base fee token his bounty if there are any.
    let settled_base_fee_result = match base_fee_result {
        Some(TokenAccountResult {
            balance_before,
            amount,
        }) => {
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    token::Transfer {
                        from: prepared_custody_token.to_account_info(),
                        to: base_fee_token.to_account_info(),
                        authority: prepared_order_response.to_account_info(),
                    },
                    &[prepared_order_response_signer_seeds],
                ),
                amount,
            )?;

            SettledTokenAccountInfo {
                key: base_fee_token.key(),
                balance_after: balance_before.saturating_add(amount),
            }
            .into()
        }
        None => None,
    };

    // Transfer the funds back to the highest bidder if there are any.
    let settled_best_offer_result = match best_offer_result {
        Some(TokenAccountResult {
            balance_before,
            amount,
        }) => {
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
                amount,
            )?;

            SettledTokenAccountInfo {
                key: best_offer_token.key(),
                balance_after: balance_before.saturating_add(amount),
            }
            .into()
        }
        None => None,
    };

    emit_cpi!(crate::events::AuctionSettled {
        fast_vaa_hash: ctx.accounts.auction.vaa_hash,
        best_offer_token: settled_best_offer_result,
        base_fee_token: settled_base_fee_result,
        with_execute: Default::default(),
    });

    // Finally close the prepared custody token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: prepared_custody_token.to_account_info(),
            destination: beneficiary.to_account_info(),
            authority: prepared_order_response.to_account_info(),
        },
        &[prepared_order_response_signer_seeds],
    ))
}
