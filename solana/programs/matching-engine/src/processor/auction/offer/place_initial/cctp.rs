use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus, MessageProtocol},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{messages::raw::LiquidityLayerMessage, TRANSFER_AUTHORITY_SEED_PREFIX};

#[derive(Accounts)]
#[instruction(offer_price: u64)]
pub struct PlaceInitialOfferCctp<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// The auction participant needs to set approval to this PDA.
    ///
    /// CHECK: Seeds must be \["transfer-authority", auction.key(), offer_price.to_be_bytes()\].
    #[account(
        seeds = [
            TRANSFER_AUTHORITY_SEED_PREFIX,
            auction.key().as_ref(),
            &offer_price.to_be_bytes()
        ],
        bump
    )]
    transfer_authority: AccountInfo<'info>,

    /// NOTE: This account is only used to pause inbound auctions.
    #[account(constraint = !custodian.paused @ MatchingEngineError::Paused)]
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

    #[account(
        constraint = {
            match fast_order_path.to_endpoint.protocol {
                MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. } => (),
                _ => return err!(MatchingEngineError::InvalidEndpoint),
            }

            let fast_vaa = fast_order_path.fast_vaa.load_unchecked();
            let message = LiquidityLayerMessage::try_from(fast_vaa.payload()).unwrap();
            let order = message
                .fast_market_order()
                .ok_or(MatchingEngineError::InvalidPayloadId)?;

            let curr_time = Clock::get().unwrap().unix_timestamp;

            // Check to see if the deadline has expired.
            let deadline = order.deadline();
            let expiration = i64::from(fast_vaa.timestamp()) + crate::VAA_AUCTION_EXPIRATION_TIME;
            require!(
                (deadline == 0 || curr_time < deadline.into()) && curr_time < expiration,
                MatchingEngineError::FastMarketOrderExpired,
            );

            require!(
                offer_price <= order.max_fee(),
                MatchingEngineError::OfferPriceTooHigh
            );

            true
        }
    )]
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

    offer_token: Account<'info, token::TokenAccount>,

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

pub fn place_initial_offer_cctp(
    ctx: Context<PlaceInitialOfferCctp>,
    offer_price: u64,
) -> Result<()> {
    // Create zero copy reference to `FastMarketOrder` payload.
    let fast_vaa = ctx.accounts.fast_order_path.fast_vaa.load_unchecked();
    let order = LiquidityLayerMessage::try_from(fast_vaa.payload())
        .unwrap()
        .to_fast_market_order_unchecked();

    // Parse the transfer amount from the VAA.
    let amount_in = order.amount_in();

    // Saturating to u64::MAX is safe here. If the amount really ends up being this large, the
    // checked addition below will catch it.
    let security_deposit =
        order
            .max_fee()
            .saturating_add(utils::auction::compute_notional_security_deposit(
                &ctx.accounts.auction_config,
                amount_in,
            ));

    // Set up the Auction account for this auction.
    let config = &ctx.accounts.auction_config;
    let initial_offer_token = ctx.accounts.offer_token.key();
    ctx.accounts.auction.set_inner(Auction {
        bump: ctx.bumps.auction,
        vaa_hash: fast_vaa.digest().0,
        vaa_timestamp: fast_vaa.timestamp(),
        target_protocol: ctx.accounts.fast_order_path.to_endpoint.protocol,
        status: AuctionStatus::Active,
        info: Some(AuctionInfo {
            config_id: config.id,
            custody_token_bump: ctx.bumps.auction_custody_token,
            vaa_sequence: fast_vaa.sequence(),
            source_chain: fast_vaa.emitter_chain(),
            best_offer_token: initial_offer_token,
            initial_offer_token,
            start_slot: Clock::get().unwrap().slot,
            amount_in,
            security_deposit,
            offer_price,
            destination_asset_info: Default::default(),
        }),
    });

    let info = ctx.accounts.auction.info.as_ref().unwrap();

    // Emit event for auction participants to listen to.
    emit!(crate::events::AuctionUpdated {
        config_id: info.config_id,
        auction: ctx.accounts.auction.key(),
        vaa: Some(ctx.accounts.fast_order_path.fast_vaa.key()),
        target_protocol: ctx.accounts.auction.target_protocol,
        end_slot: info.auction_end_slot(config),
        best_offer_token: initial_offer_token,
        token_balance_before: ctx.accounts.offer_token.amount,
        amount_in,
        total_deposit: info.total_deposit(),
        max_offer_price_allowed: utils::auction::compute_min_allowed_offer(config, info),
    });

    // Finally transfer tokens from the offer authority's token account to the
    // auction's custody account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.offer_token.to_account_info(),
                to: ctx.accounts.auction_custody_token.to_account_info(),
                authority: ctx.accounts.transfer_authority.to_account_info(),
            },
            &[&[
                TRANSFER_AUTHORITY_SEED_PREFIX,
                ctx.accounts.auction.key().as_ref(),
                &offer_price.to_be_bytes(),
                &[ctx.bumps.transfer_authority],
            ]],
        ),
        amount_in
            .checked_add(security_deposit)
            .ok_or(MatchingEngineError::U64Overflow)?,
    )
}
