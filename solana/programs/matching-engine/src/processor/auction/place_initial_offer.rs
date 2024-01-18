use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerPayload;
use wormhole_cctp_solana::wormhole::core_bridge_program;
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;

use crate::{
    error::MatchingEngineError,
    state::{AuctionData, AuctionStatus, Custodian, RouterEndpoint},
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
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

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
    offer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, fee_offer: u64) -> Result<()> {
    // Create zero copy reference to `FastMarketOrder` payload.
    let vaa = VaaAccount::load(&ctx.accounts.vaa)?;
    let msg = LiquidityLayerPayload::try_from(vaa.try_payload()?)
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;

    // We need to fetch clock values for a couple of operations in this instruction.
    let clock = Clock::get()?;

    // Check to see if the deadline has expired.
    let deadline = i64::from(fast_order.deadline());
    require!(
        deadline == 0 || clock.unix_timestamp < deadline,
        MatchingEngineError::FastMarketOrderExpired,
    );

    let max_fee = u64::try_from(fast_order.max_fee()).unwrap();
    require!(fee_offer <= max_fee, MatchingEngineError::OfferPriceTooHigh);

    // Verify that the to and from router endpoints are valid.
    crate::utils::verify_router_path(
        &vaa,
        &ctx.accounts.from_router_endpoint,
        &ctx.accounts.to_router_endpoint,
        fast_order.target_chain(),
    )?;

    // Parse the transfer amount from the VAA.
    let amount = u64::try_from(fast_order.amount_in()).unwrap();

    // Transfer tokens from the offer authority's token account to the custodian.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.offer_token.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        amount + fee_offer,
    )?;

    // Set up the AuctionData account for this auction.
    let initial_offer_token = ctx.accounts.offer_token.key();
    ctx.accounts.auction_data.set_inner(AuctionData {
        bump: ctx.bumps["auction_data"],
        vaa_hash: vaa.try_digest().unwrap().0,
        status: AuctionStatus::Active,
        best_offer_token: initial_offer_token,
        initial_offer_token,
        start_slot: clock.slot,
        amount,
        security_deposit: max_fee,
        offer_price: fee_offer,
    });

    Ok(())
}
