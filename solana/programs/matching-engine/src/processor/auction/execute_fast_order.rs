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
pub struct ExecuteFastOrder<'info> {
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
        mut,
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
    executor_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        token::mint = custody_token.mint,
        constraint = best_offer_token.key() == auction_data.best_offer.key() @ MatchingEngineError::InvalidTokenAccount,
    )]
    best_offer_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        token::mint = custody_token.mint,
        constraint = initial_offer_token.key() == auction_data.initial_auctioneer.key() @ MatchingEngineError::InvalidTokenAccount,
    )]
    initial_offer_token: Account<'info, token::TokenAccount>,

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

pub fn execute_fast_order(ctx: Context<ExecuteFastOrder>) -> Result<()> {
    require!(
        ctx.accounts.auction_data.status == AuctionStatus::Active,
        MatchingEngineError::AuctionNotActive
    );

    let slots_elapsed = Clock::get()?
        .slot
        .checked_sub(ctx.accounts.auction_data.start_slot)
        .unwrap();
    let auction_config = &ctx.accounts.custodian.auction_config;
    require!(
        slots_elapsed > u64::try_from(auction_config.auction_duration).unwrap(),
        MatchingEngineError::AuctionPeriodNotExpired
    );

    // Create zero copy reference to `FastMarketOrder` payload.
    let vaa = VaaAccount::load(&ctx.accounts.vaa)?;
    let msg = LiquidityLayerPayload::try_from(vaa.try_payload()?)
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;
    let auction_data = &mut ctx.accounts.auction_data;

    // Save the custodian seeds to sign transfers with.
    let custodian_seeds = &[
        Custodian::SEED_PREFIX.as_ref(),
        &[ctx.accounts.custodian.bump],
    ];

    if slots_elapsed > u64::try_from(auction_config.auction_grace_period).unwrap() {
        let (penalty, reward) = ctx
            .accounts
            .custodian
            .calculate_dynamic_penalty(auction_data.security_deposit, slots_elapsed)
            .ok_or(MatchingEngineError::PenaltyCalculationFailed)?;

        // If caller passes in the same token account, only perform one transfer.
        if ctx.accounts.best_offer_token.key() == ctx.accounts.executor_token.key() {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.custody_token.to_account_info(),
                        to: ctx.accounts.best_offer_token.to_account_info(),
                        authority: ctx.accounts.custodian.to_account_info(),
                    },
                    &[&custodian_seeds[..]],
                ),
                auction_data
                    .offer_price
                    .checked_add(auction_data.security_deposit)
                    .unwrap()
                    .checked_sub(reward)
                    .unwrap(),
            )?;
        } else {
            // Pay the liquidator the penalty.
            if penalty > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: ctx.accounts.custody_token.to_account_info(),
                            to: ctx.accounts.executor_token.to_account_info(),
                            authority: ctx.accounts.custodian.to_account_info(),
                        },
                        &[&custodian_seeds[..]],
                    ),
                    penalty,
                )?;
            }

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.custody_token.to_account_info(),
                        to: ctx.accounts.best_offer_token.to_account_info(),
                        authority: ctx.accounts.custodian.to_account_info(),
                    },
                    &[&custodian_seeds[..]],
                ),
                auction_data
                    .offer_price
                    .checked_add(auction_data.security_deposit)
                    .unwrap()
                    .checked_sub(reward)
                    .unwrap()
                    .checked_sub(penalty)
                    .unwrap(),
            )?;
        }

        // TODO: Do the CCTP transfer or create a fast fill here.
    } else {
        // Return the security deposit and the fee to the highest bidder.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.custody_token.to_account_info(),
                    to: ctx.accounts.best_offer_token.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[&custodian_seeds[..]],
            ),
            auction_data
                .offer_price
                .checked_add(auction_data.security_deposit)
                .unwrap(),
        )?;
    }

    // Pay the auction initiator their fee.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.initial_offer_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[&custodian_seeds[..]],
        ),
        u64::try_from(fast_order.init_auction_fee()).unwrap(),
    )?;

    // Set the auction status to completed.
    auction_data.status = AuctionStatus::Completed;

    Ok(())
}

// TODO: need to validate that the caller passed in the correct token accounts
// and not just their own to steal funds. Look at ALL instructions.
