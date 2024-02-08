use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::LiquidityLayerPayload,
    wormhole_cctp_solana::wormhole::core_bridge_program::{self, VaaAccount},
};

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus, Custodian, RouterEndpoint},
};

#[derive(Accounts)]
pub struct PlaceInitialOffer<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    // TODO: add initial_offer authority. Do not require to be owner?
    // initial_offer_authority: Signer<'info>,
    //
    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

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
            VaaAccount::load(&fast_vaa)?.try_digest()?.as_ref(),
        ],
        bump
    )]
    auction: Box<Account<'info, Auction>>,

    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            from_router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = from_router_endpoint.bump,
    )]
    from_router_endpoint: Account<'info, RouterEndpoint>,

    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            to_router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = to_router_endpoint.bump,
    )]
    to_router_endpoint: Account<'info, RouterEndpoint>,

    #[account(
        mut,
        associated_token::mint = custody_token.mint,
        associated_token::authority = payer
    )]
    offer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        address = crate::custody_token::id() @ MatchingEngineError::InvalidCustodyToken,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, fee_offer: u64) -> Result<()> {
    // Create zero copy reference to `FastMarketOrder` payload.
    let fast_vaa = VaaAccount::load(&ctx.accounts.fast_vaa)?;
    let msg = LiquidityLayerPayload::try_from(fast_vaa.try_payload()?)
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;

    let source_chain = fast_vaa.try_emitter_chain()?;

    // We need to fetch clock values for a couple of operations in this instruction.
    let Clock {
        slot,
        unix_timestamp,
        ..
    } = Clock::get()?;

    // Check to see if the deadline has expired.
    let deadline = i64::from(fast_order.deadline());
    require!(
        deadline == 0 || unix_timestamp < deadline,
        MatchingEngineError::FastMarketOrderExpired,
    );

    let max_fee = fast_order.max_fee();
    require!(fee_offer <= max_fee, MatchingEngineError::OfferPriceTooHigh);

    // Verify that the to and from router endpoints are valid.
    crate::utils::require_valid_router_path(
        &fast_vaa,
        &ctx.accounts.from_router_endpoint,
        &ctx.accounts.to_router_endpoint,
        fast_order.target_chain(),
    )?;

    // Parse the transfer amount from the VAA.
    let amount_in = fast_order.amount_in();

    // Transfer tokens from the offer authority's token account to the custodian.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.offer_token.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount_in + max_fee,
    )?;

    // Set up the Auction account for this auction.
    let initial_offer_token = ctx.accounts.offer_token.key();
    ctx.accounts.auction.set_inner(Auction {
        bump: ctx.bumps.auction,
        vaa_hash: fast_vaa.try_digest().unwrap().0,
        status: AuctionStatus::Active,
        info: Some(AuctionInfo {
            config_id: ctx.accounts.auction_config.id,
            source_chain,
            best_offer_token: initial_offer_token,
            initial_offer_token,
            start_slot: slot,
            amount_in,
            security_deposit: max_fee,
            offer_price: fee_offer,
            amount_out: amount_in,
        }),
    });

    Ok(())
}
