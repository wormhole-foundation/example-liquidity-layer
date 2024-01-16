use crate::{
    error::MatchingEngineError,
    state::{AuctionData, AuctionStatus, Custodian},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ImproveOffer<'info> {
    offer_authority: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        mut,
        seeds = [
            AuctionData::SEED_PREFIX,
            auction_data.vaa_hash.as_ref(),
        ],
        bump
    )]
    auction_data: Account<'info, AuctionData>,

    #[account(
        mut,
        associated_token::mint = custody_token.mint,
        associated_token::authority = offer_authority
    )]
    offer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        constraint = {
            best_offer_token.key() == auction_data.best_offer.key()
        } @ MatchingEngineError::InvalidTokenAccount,
    )]
    best_offer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
    let auction_data = &mut ctx.accounts.auction_data;

    require!(
        auction_data.status == AuctionStatus::Active,
        MatchingEngineError::AuctionNotActive
    );

    // Push this to the stack to enhance readability.
    let auction_duration = ctx.accounts.custodian.auction_config.auction_duration;
    require!(
        Clock::get()?.slot.saturating_sub(auction_duration.into()) < auction_data.start_slot,
        MatchingEngineError::AuctionPeriodExpired
    );

    // Make sure the new offer is less than the previous offer.
    require!(
        fee_offer < auction_data.offer_price,
        MatchingEngineError::OfferPriceNotImproved
    );

    // Transfer funds from the `best_offer` token account to the `offer_token` token account,
    // but only if the pubkeys are different.
    if auction_data.best_offer != *ctx.accounts.offer_token.to_account_info().key {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.offer_token.to_account_info(),
                    to: ctx.accounts.best_offer_token.to_account_info(),
                    authority: ctx.accounts.offer_authority.to_account_info(),
                },
            ),
            auction_data
                .amount
                .checked_add(auction_data.security_deposit)
                .ok_or(MatchingEngineError::Overflow)?,
        )?;

        // Update the `best_offer` token account and `amount` fields.
        auction_data.best_offer = ctx.accounts.offer_token.key();
        auction_data.offer_price = fee_offer;
    } else {
        // Since the auctioneer is already the best offer, we only need to update the `amount`.
        auction_data.offer_price = fee_offer;
    }

    Ok(())
}
