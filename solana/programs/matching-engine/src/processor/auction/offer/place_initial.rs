use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::LiquidityLayerPayload,
    wormhole_cctp_solana::wormhole::{core_bridge_program, VaaAccount},
};

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus, Custodian, RouterEndpoint},
    utils,
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
            VaaAccount::load(&fast_vaa)?.digest().as_ref(),
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
        associated_token::mint = cctp_mint_recipient.mint,
        associated_token::authority = payer
    )]
    offer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        address = crate::cctp_mint_recipient::id() @ MatchingEngineError::InvalidCustodyToken,
    )]
    cctp_mint_recipient: Account<'info, token::TokenAccount>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, offer_price: u64) -> Result<()> {
    // Create zero copy reference to `FastMarketOrder` payload.
    let fast_vaa = VaaAccount::load(&ctx.accounts.fast_vaa)?;
    let msg = LiquidityLayerPayload::try_from(fast_vaa.payload())
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;

    let source_chain = fast_vaa.emitter_chain();

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
    require!(
        offer_price <= max_fee,
        MatchingEngineError::OfferPriceTooHigh
    );

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
                to: ctx.accounts.cctp_mint_recipient.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount_in + max_fee,
    )?;

    // Set up the Auction account for this auction.
    let initial_offer_token = ctx.accounts.offer_token.key();
    let vaa_sequence = fast_vaa.sequence();

    let info = AuctionInfo {
        config_id: ctx.accounts.auction_config.id,
        vaa_sequence,
        source_chain,
        best_offer_token: initial_offer_token,
        initial_offer_token,
        start_slot: slot,
        amount_in,
        security_deposit: max_fee,
        offer_price,
        amount_out: amount_in,
    };

    // Emit event for auction participants to listen to.
    emit!(crate::events::AuctionUpdate {
        source_chain,
        vaa_sequence,
        end_slot: slot.saturating_add(ctx.accounts.auction_config.duration.into()),
        offer_token: info.best_offer_token,
        amount_in,
        total_deposit: info.total_deposit(),
        max_offer_price_allowed: utils::auction::max_offer_price_allowed(
            &ctx.accounts.auction_config,
            &info,
        ),
    });

    // Set the Auction account.
    ctx.accounts.auction.set_inner(Auction {
        bump: ctx.bumps.auction,
        vaa_hash: fast_vaa.digest().0,
        status: AuctionStatus::Active,
        info: Some(info),
    });

    // Done.
    Ok(())
}
