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
        associated_token::mint = common::constants::USDC_MINT,
        associated_token::authority = offer_authority
    )]
    offer_token: Account<'info, token::TokenAccount>,

    /// CHECK: Mutable. Must have the same key in auction data.
    #[account(mut)]
    best_offer_token: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
}

pub fn improve_offer(ctx: Context<ImproveOffer>, offer_price: u64) -> Result<()> {
    let auction_info = ctx.accounts.auction.info.as_mut().unwrap();

    let end_slot = auction_info.auction_end_slot(&ctx.accounts.auction_config);
    {
        let current_slot = Clock::get().map(|clock| clock.slot)?;
        require!(
            current_slot <= end_slot,
            MatchingEngineError::AuctionPeriodExpired
        );
    }

    // This check is safe because we already checked the new offer is less than `offer_price`.
    require!(
        offer_price
            <= utils::auction::max_offer_price_allowed(&ctx.accounts.auction_config, auction_info),
        MatchingEngineError::CarpingNotAllowed
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

    auction_info.offer_price = offer_price;

    // Emit event for auction participants to listen to.
    emit!(crate::events::AuctionUpdate {
        source_chain: auction_info.source_chain,
        vaa_sequence: auction_info.vaa_sequence,
        end_slot,
        amount_in: auction_info.amount_in,
        max_offer_price_allowed: utils::auction::max_offer_price_allowed(
            &ctx.accounts.auction_config,
            auction_info
        ),
    });

    Ok(())
}
