use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerPayload;
use wormhole_cctp_solana::wormhole::core_bridge_program;
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;

use crate::{
    error::MatchingEngineError,
    processor::verify_router_path,
    state::{AuctionData, AuctionStatus, Custodian, RouterEndpoint},
};

#[derive(Accounts)]
pub struct PlaceInitialOffer<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        init,
        payer = payer,
        space = 8 + AuctionData::INIT_SPACE,
        seeds = [
            AuctionData::SEED_PREFIX,
            VaaAccount::load(&vaa)?.try_digest()?.as_ref(),
        ],
        bump
    )]
    auction_data: Account<'info, AuctionData>,

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
    auctioneer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, fee_offer: u64) -> Result<()> {
    // Make sure the auction hasn't been started for this VAA.
    require!(
        ctx.accounts.auction_data.status == AuctionStatus::NotStarted,
        MatchingEngineError::AuctionAlreadyStarted,
    );

    // Create zero copy reference to `FastMarketOrder` payload.
    let vaa = VaaAccount::load(&ctx.accounts.vaa)?;
    let msg = LiquidityLayerPayload::try_from(vaa.try_payload()?)
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;

    // Check to see if the deadline has expired.
    let deadline = fast_order.deadline();
    let current_time = u32::try_from(Clock::get()?.unix_timestamp).ok().unwrap();
    let max_fee = u64::try_from(fast_order.max_fee()).unwrap();

    require!(
        current_time < deadline || deadline == 0,
        MatchingEngineError::FastMarketOrderExpired,
    );
    require!(fee_offer <= max_fee, MatchingEngineError::OfferPriceTooHigh);

    // Verify that the to and from router endpoints are valid.
    verify_router_path(
        &ctx.accounts.from_router_endpoint,
        &ctx.accounts.to_router_endpoint,
        &vaa.try_emitter_info().unwrap(),
        fast_order.target_chain(),
    )?;

    // Parse the transfer amount from the VAA.
    let amount = u64::try_from(fast_order.amount_in()).unwrap();

    // Transfer tokens from the auctioneer to the custodian.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.auctioneer_token.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        u64::try_from(amount)
            .unwrap()
            .checked_add(u64::try_from(fee_offer).unwrap())
            .unwrap(),
    )?;

    // Set up the AuctionData account for this auction.
    ctx.accounts.auction_data.set_inner(AuctionData {
        bump: ctx.bumps["auction_data"],
        vaa_hash: vaa.try_digest()?.as_ref().try_into().unwrap(),
        status: AuctionStatus::Active,
        best_offer: *ctx.accounts.payer.key,
        initial_auctioneer: *ctx.accounts.payer.key,
        start_slot: Clock::get()?.slot,
        amount,
        security_deposit: max_fee,
        offer_price: fee_offer,
    });

    Ok(())
}
