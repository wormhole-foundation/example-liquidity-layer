use crate::{
    error::MatchingEngineError,
    state::{auction::*, custodian::*},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ImproveOffer<'info> {
    custodian: CheckedCustodian<'info>,

    active_auction: ActiveAuction<'info>,

    new_offer: NewAuctionOffer<'info>,

    token_program: Program<'info, token::Token>,
}

pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
    let auction_info = ctx.accounts.active_auction.auction.info.as_mut().unwrap();

    {
        let current_slot = Clock::get().unwrap().slot;
        require!(
            current_slot <= auction_info.auction_end_slot(&ctx.accounts.active_auction.config),
            MatchingEngineError::AuctionPeriodExpired
        );
    }

    // Make sure the new offer is less than the previous offer.
    require!(
        fee_offer < auction_info.offer_price,
        MatchingEngineError::OfferPriceNotImproved
    );

    // This check is safe because we already checked that `fee_offer` is less than `offer_price`.
    {
        let min_offer_delta = utils::auction::compute_min_offer_delta(
            &ctx.accounts.active_auction.config,
            auction_info,
        );
        require!(
            auction_info.offer_price - fee_offer >= min_offer_delta,
            MatchingEngineError::CarpingNotAllowed
        );
    }

    // Transfer funds from the `offer_token` token account to the `best_offer_token` token account,
    // but only if the pubkeys are different.
    let offer_token = ctx.accounts.new_offer.token.key();
    if auction_info.best_offer_token != offer_token {
        // These operations will seem silly, but we do this as a safety measure to ensure that
        // nothing terrible happened with the auction's custody account.
        let total_deposit = ctx.accounts.active_auction.custody_token.amount;

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
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            total_deposit,
        )?;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.new_offer.token.to_account_info(),
                    to: ctx.accounts.active_auction.custody_token.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            total_deposit,
        )?;

        // Update the `best_offer` token account and `amount` fields.
        auction_info.best_offer_token = offer_token;
    }

    auction_info.offer_price = fee_offer;

    Ok(())
}
