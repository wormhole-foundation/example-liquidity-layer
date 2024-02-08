use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, Custodian},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ImproveOffer<'info> {
    /// This program's Wormhole (Core Bridge) emitter authority. This is also the burn-source
    /// authority for CCTP transfers.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: AccountInfo<'info>,

    auction_config: Account<'info, AuctionConfig>,

    offer_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            Auction::SEED_PREFIX,
            auction.vaa_hash.as_ref(),
        ],
        bump = auction.bump,
        constraint = utils::is_valid_active_auction(
            &auction_config,
            &auction,
            Some(best_offer_token.key()),
            None,
        )?
    )]
    auction: Account<'info, Auction>,

    #[account(
        mut,
        associated_token::mint = common::constants::usdc::id(),
        associated_token::authority = offer_authority
    )]
    offer_token: Account<'info, token::TokenAccount>,

    /// CHECK: Mutable. Must have the same key in auction data.
    #[account(mut)]
    best_offer_token: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
}

pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
    let auction_info = ctx.accounts.auction.info.as_mut().unwrap();

    {
        let current_slot = Clock::get().map(|clock| clock.slot)?;
        require!(
            current_slot <= auction_info.auction_end_slot(&ctx.accounts.auction_config),
            MatchingEngineError::AuctionPeriodExpired
        );
    }

    // Make sure the new offer is less than the previous offer.
    require!(
        fee_offer < auction_info.offer_price,
        MatchingEngineError::OfferPriceNotImproved
    );

    // Transfer funds from the `best_offer` token account to the `offer_token` token account,
    // but only if the pubkeys are different.
    let offer_token = ctx.accounts.offer_token.key();
    if auction_info.best_offer_token != offer_token {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.offer_token.to_account_info(),
                    to: ctx.accounts.best_offer_token.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            auction_info.total_deposit(),
        )?;

        // Update the `best_offer` token account and `amount` fields.
        auction_info.best_offer_token = offer_token;
    }

    auction_info.offer_price = fee_offer;

    Ok(())
}
