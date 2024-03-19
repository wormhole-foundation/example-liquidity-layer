use crate::{
    error::MatchingEngineError,
    processor::shared_contexts::*,
    state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::LiquidityLayerPayload,
    wormhole_cctp_solana::wormhole::{core_bridge_program, VaaAccount},
};

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

    /// CHECK: Must be owned by the Wormhole Core Bridge program.
    #[account(owner = core_bridge_program::id())]
    fast_vaa: AccountInfo<'info>,

    /// This account should only be created once, and should never be changed to
    /// init_if_needed. Otherwise someone can game an existing auction.
    #[account(
        init,
        payer = payer,
        space = 8 + Auction::INIT_SPACE,
        seeds = [
            Auction::SEED_PREFIX,
            VaaAccount::load(&fast_vaa)?.digest().as_ref(),
        ],
        bump
    )]
    auction: Box<Account<'info, Auction>>,

    router_endpoint_pair: LiveRouterEndpointPair<'info>,

    /// CHECK: Must be a token account, whose mint is `USDC_MINT` and have delegated authority to
    /// the auction PDA.
    offer_token: AccountInfo<'info>,

    #[account(
        init_if_needed,
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
    let fast_vaa = VaaAccount::load_unchecked(&ctx.accounts.fast_vaa);
    let msg = LiquidityLayerPayload::try_from(fast_vaa.payload())
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;

    let source_chain = fast_vaa.emitter_chain();

    // We need to fetch clock values for a couple of operations in this instruction.
    let start_slot = {
        let Clock {
            slot,
            unix_timestamp,
            ..
        } = Clock::get().unwrap();

        // Check to see if the deadline has expired.
        let deadline = i64::from(fast_order.deadline());
        require!(
            deadline == 0 || unix_timestamp < deadline,
            MatchingEngineError::FastMarketOrderExpired,
        );

        slot
    };

    let max_fee = fast_order.max_fee();
    require!(
        offer_price <= max_fee,
        MatchingEngineError::OfferPriceTooHigh
    );

    // Verify that the to and from router endpoints are valid.
    crate::utils::require_valid_router_path(
        &fast_vaa,
        &ctx.accounts.router_endpoint_pair.from,
        &ctx.accounts.router_endpoint_pair.to,
        fast_order.target_chain(),
    )?;

    // Parse the transfer amount from the VAA.
    let amount_in = fast_order.amount_in();

    // Set up the Auction account for this auction.
    let initial_offer_token = ctx.accounts.offer_token.key();
    let vaa_hash = fast_vaa.digest().0;
    ctx.accounts.auction.set_inner(Auction {
        bump: ctx.bumps.auction,
        vaa_hash,
        custody_token_bump: ctx.bumps.auction_custody_token,
        status: AuctionStatus::Active,
        info: Some(AuctionInfo {
            config_id: ctx.accounts.auction_config.id,
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
