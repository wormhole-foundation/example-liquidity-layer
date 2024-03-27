use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerMessage;

#[derive(Accounts)]
pub struct PlaceInitialOffer<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// NOTE: Currently not used for anything. But this account can be used in
    /// case we need to pause starting auctions.
    custodian: CheckedCustodian<'info>,

    #[account(
        constraint = {
            require_eq!(
                auction_config.id,
                custodian.auction_config_id,
                MatchingEngineError::AuctionConfigMismatch,
            );
            true
        }
    )]
    auction_config: Account<'info, AuctionConfig>,

    fast_order_path: FastOrderPath<'info>,

    /// This account should only be created once, and should never be changed to
    /// init_if_needed. Otherwise someone can game an existing auction.
    #[account(
        init,
        payer = payer,
        space = 8 + Auction::INIT_SPACE,
        seeds = [
            Auction::SEED_PREFIX,
            fast_order_path.fast_vaa.load_unchecked().digest().as_ref(),
        ],
        bump
    )]
    auction: Box<Account<'info, Auction>>,

    /// CHECK: Must be a token account, whose mint is `USDC_MINT` and have delegated authority to
    /// the auction PDA.
    offer_token: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        token::mint = usdc,
        token::authority = auction,
        seeds = [
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            auction.key().as_ref(),
        ],
        bump,
    )]
    auction_custody_token: Account<'info, token::TokenAccount>,

    usdc: Usdc<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, offer_price: u64) -> Result<()> {
    // Create zero copy reference to `FastMarketOrder` payload.
    let fast_vaa = ctx.accounts.fast_order_path.fast_vaa.load_unchecked();
    let order = LiquidityLayerMessage::try_from(fast_vaa.payload())
        .unwrap()
        .to_fast_market_order_unchecked();

    let source_chain = fast_vaa.emitter_chain();

    // We need to fetch clock values for a couple of operations in this instruction.
    let start_slot = {
        let Clock {
            slot,
            unix_timestamp,
            ..
        } = Clock::get().unwrap();

        // Check to see if the deadline has expired.
        let deadline = i64::from(order.deadline());
        require!(
            deadline == 0 || unix_timestamp < deadline,
            MatchingEngineError::FastMarketOrderExpired,
        );

        slot
    };

    let max_fee = order.max_fee();
    require!(
        offer_price <= max_fee,
        MatchingEngineError::OfferPriceTooHigh
    );

    // Parse the transfer amount from the VAA.
    let amount_in = order.amount_in();

    // Set up the Auction account for this auction.
    let initial_offer_token = ctx.accounts.offer_token.key();
    let vaa_hash = fast_vaa.digest().0;
    ctx.accounts.auction.set_inner(Auction {
        bump: ctx.bumps.auction,
        vaa_hash,
        status: AuctionStatus::Active,
        info: Some(AuctionInfo {
            config_id: ctx.accounts.auction_config.id,
            custody_token_bump: ctx.bumps.auction_custody_token,
            vaa_sequence: fast_vaa.sequence(),
            source_chain,
            best_offer_token: initial_offer_token,
            initial_offer_token,
            start_slot,
            amount_in,
            security_deposit: max_fee,
            offer_price,
            amount_out: amount_in,
        }),
    });

    // Finally transfer tokens from the offer authority's token account to the
    // auction's custody account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.offer_token.to_account_info(),
                to: ctx.accounts.auction_custody_token.to_account_info(),
                authority: ctx.accounts.auction.to_account_info(),
            },
            &[&[
                Auction::SEED_PREFIX,
                vaa_hash.as_ref(),
                &[ctx.bumps.auction],
            ]],
        ),
        amount_in + max_fee,
    )
}
