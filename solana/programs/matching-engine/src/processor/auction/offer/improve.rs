use crate::{error::MatchingEngineError, processor::shared_contexts::*, state::Auction, utils};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ImproveOffer<'info> {
    active_auction: ActiveAuction<'info>,

    /// CHECK: Must be a token account, whose mint is `USDC_MINT` and have delegated authority to
    /// the auction PDA.
    offer_token: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
}

pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
    let offer_token = {
        let Auction {
            bump,
            vaa_hash,
            info,
            ..
        } = ctx.accounts.active_auction.as_ref();

        // This is safe because we know that this is an active auction.
        let info = info.as_ref().unwrap();

        {
            let current_slot = Clock::get().unwrap().slot;
            require!(
                current_slot <= info.auction_end_slot(&ctx.accounts.active_auction.config),
                MatchingEngineError::AuctionPeriodExpired
            );
        }

        // Make sure the new offer is less than the previous offer.
        require!(
            fee_offer < info.offer_price,
            MatchingEngineError::OfferPriceNotImproved
        );

        // This check is safe because we already checked that `fee_offer` is less than `offer_price`.
        {
            let min_offer_delta =
                utils::auction::compute_min_offer_delta(&ctx.accounts.active_auction.config, info);
            require!(
                info.offer_price - fee_offer >= min_offer_delta,
                MatchingEngineError::CarpingNotAllowed
            );
        }

        // Transfer funds from the `offer_token` token account to the `best_offer_token` token account,
        // but only if the pubkeys are different.
        let offer_token = ctx.accounts.offer_token.key();
        if info.best_offer_token != offer_token {
            // These operations will seem silly, but we do this as a safety measure to ensure that
            // nothing terrible happened with the auction's custody account.
            let total_deposit = ctx.accounts.active_auction.custody_token.amount;

            let auction_signer_seeds = &[Auction::SEED_PREFIX, vaa_hash.as_ref(), &[*bump]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.active_auction.custody_token.to_account_info(),
                        to: ctx
                            .accounts
                            .active_auction
                            .best_offer_token
                            .to_account_info(),
                        authority: ctx.accounts.active_auction.auction.to_account_info(),
                    },
                    &[auction_signer_seeds],
                ),
                total_deposit,
            )?;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.offer_token.to_account_info(),
                        to: ctx.accounts.active_auction.custody_token.to_account_info(),
                        authority: ctx.accounts.active_auction.auction.to_account_info(),
                    },
                    &[auction_signer_seeds],
                ),
                total_deposit,
            )?;
        }

        offer_token
    };

    let auction_info = ctx.accounts.active_auction.info.as_mut().unwrap();
    auction_info.best_offer_token = offer_token;
    auction_info.offer_price = fee_offer;

    Ok(())
}
