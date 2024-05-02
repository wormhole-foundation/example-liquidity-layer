use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{FastFill, RouterEndpoint},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

/// Accounts required for [complete_fast_fill].
#[derive(Accounts)]
pub struct CompleteFastFill<'info> {
    custodian: CheckedCustodian<'info>,

    #[account(
        mut,
        seeds = [
            FastFill::SEED_PREFIX,
            &fast_fill.seeds.source_chain.to_be_bytes(),
            &fast_fill.seeds.order_sender,
            &fast_fill.seeds.sequence.to_be_bytes(),
        ],
        bump = fast_fill.seeds.bump,
        constraint = !fast_fill.redeemed @ MatchingEngineError::FastFillAlreadyRedeemed,
    )]
    fast_fill: Account<'info, FastFill>,

    #[account(address = Pubkey::from(path.to_endpoint.address))]
    token_router_emitter: Signer<'info>,

    #[account(
        mut,
        token::mint = local_custody_token.mint,
    )]
    token_router_custody_token: Account<'info, token::TokenAccount>,

    #[account(
        constraint = {
            require_eq!(
                path.from_endpoint.chain,
                fast_fill.seeds.source_chain,
                MatchingEngineError::InvalidSourceRouter
            );

            require_eq!(
                path.to_endpoint.chain,
                SOLANA_CHAIN,
                MatchingEngineError::InvalidTargetRouter
            );

            true
        }
    )]
    path: LiveRouterPath<'info>,

    #[account(
        mut,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            &fast_fill.seeds.source_chain.to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    token_program: Program<'info, token::Token>,
}

pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
    // Mark fast fill account as redeemed. This will block subsequent calls for this fast fill.
    ctx.accounts.fast_fill.redeemed = true;

    // Finally transfer to local token router's token account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.local_custody_token.to_account_info(),
                to: ctx.accounts.token_router_custody_token.to_account_info(),
                authority: ctx.accounts.path.from_endpoint.to_account_info(),
            },
            &[&[
                RouterEndpoint::SEED_PREFIX,
                &ctx.accounts.path.from_endpoint.chain.to_be_bytes(),
                &[ctx.accounts.path.from_endpoint.bump],
            ]],
        ),
        ctx.accounts.fast_fill.info.amount,
    )
}
