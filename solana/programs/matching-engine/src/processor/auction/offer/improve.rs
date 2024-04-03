use crate::{composite::*, error::MatchingEngineError, state::Auction, utils};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::TRANSFER_AUTHORITY_SEED_PREFIX;

#[derive(Accounts)]
#[instruction(offer_price: u64)]
pub struct ImproveOffer<'info> {
    /// The auction participant needs to set approval to this PDA.
    ///
    /// CHECK: Seeds must be \["transfer-authority", auction.key(), offer_price.to_be_bytes()\].
    #[account(
        seeds = [
            TRANSFER_AUTHORITY_SEED_PREFIX,
            active_auction.key().as_ref(),
            &offer_price.to_be_bytes()
        ],
        bump
    )]
    transfer_authority: AccountInfo<'info>,

    #[account(
        constraint = {
            // This is safe because we know that this is an active auction.
            let info = active_auction.info.as_ref().unwrap();

            require!(
                Clock::get().unwrap().slot <= info.auction_end_slot(&active_auction.config),
                MatchingEngineError::AuctionPeriodExpired
            );

            require!(
                offer_price
                    <= utils::auction::compute_min_allowed_offer(&active_auction.config, info),
                MatchingEngineError::CarpingNotAllowed
            );

            true
        }
    )]
    active_auction: ActiveAuction<'info>,

    offer_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn improve_offer(ctx: Context<ImproveOffer>, offer_price: u64) -> Result<()> {
    let offer_token = &ctx.accounts.offer_token;

    {
        let ActiveAuction {
            auction,
            custody_token,
            best_offer_token,
            config,
        } = &ctx.accounts.active_auction;

        let token_program = &ctx.accounts.token_program;

        // Transfer funds from the `offer_token` token account to the `best_offer_token` token account,
        // but only if the pubkeys are different.
        if offer_token.key() != best_offer_token.key() {
            // These operations will seem silly, but we do this as a safety measure to ensure that
            // nothing terrible happened with the auction's custody account.
            let total_deposit = ctx.accounts.active_auction.custody_token.amount;

            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: custody_token.to_account_info(),
                        to: best_offer_token.to_account_info(),
                        authority: auction.to_account_info(),
                    },
                    &[&[
                        Auction::SEED_PREFIX,
                        auction.vaa_hash.as_ref(),
                        &[auction.bump],
                    ]],
                ),
                total_deposit,
            )?;

            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: offer_token.to_account_info(),
                        to: custody_token.to_account_info(),
                        authority: ctx.accounts.transfer_authority.to_account_info(),
                    },
                    &[&[
                        TRANSFER_AUTHORITY_SEED_PREFIX,
                        auction.key().as_ref(),
                        &offer_price.to_be_bytes(),
                        &[ctx.bumps.transfer_authority],
                    ]],
                ),
                total_deposit,
            )?;
        }

        let info = ctx.accounts.active_auction.info.as_ref().unwrap();

        // Emit event for auction participants to listen to.
        emit!(crate::events::AuctionUpdated {
            auction: auction.key(),
            vaa: Default::default(),
            end_slot: info.auction_end_slot(config),
            best_offer_token: offer_token.key(),
            token_balance_before: offer_token.amount,
            amount_in: info.amount_in,
            total_deposit: info.total_deposit(),
            max_offer_price_allowed: utils::auction::compute_min_allowed_offer(config, info),
        });
    }

    let info = ctx.accounts.active_auction.info.as_mut().unwrap();
    info.best_offer_token = offer_token.key();
    info.offer_price = offer_price;

    Ok(())
}
