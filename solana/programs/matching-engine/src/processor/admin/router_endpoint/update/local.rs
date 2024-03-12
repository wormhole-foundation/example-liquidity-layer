use crate::{
    error::MatchingEngineError,
    state::{Custodian, RouterEndpoint},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    admin::utils::assistant::only_authorized, wormhole_cctp_solana::wormhole::SOLANA_CHAIN,
};

#[derive(Accounts)]
pub struct UpdateLocalRouterEndpoint<'info> {
    #[account(
        mut,
        constraint = {
            only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        mut,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &SOLANA_CHAIN.to_be_bytes()
        ],
        bump = router_endpoint.bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    /// CHECK: Must be an executable (the Token Router program), whose ID will be used to derive the
    /// emitter (router endpoint) address.
    #[account(executable)]
    token_router_program: AccountInfo<'info>,

    /// CHECK: The Token Router program's emitter PDA (a.k.a. its custodian) will have account data.
    #[account(
        seeds = [b"emitter"],
        bump,
        seeds::program = token_router_program,
        owner = token_router_program.key() @ MatchingEngineError::InvalidEndpoint,
        constraint = !token_router_emitter.data_is_empty() @ MatchingEngineError::InvalidEndpoint,
    )]
    token_router_emitter: AccountInfo<'info>,

    #[account(
        associated_token::mint = common::constants::USDC_MINT,
        associated_token::authority = token_router_emitter,
    )]
    token_router_custody_token: Account<'info, token::TokenAccount>,
}

pub fn update_local_router_endpoint(ctx: Context<UpdateLocalRouterEndpoint>) -> Result<()> {
    utils::admin::handle_add_local_router_endpoint(
        &mut ctx.accounts.router_endpoint,
        &ctx.accounts.token_router_program,
        &ctx.accounts.token_router_emitter,
        &ctx.accounts.token_router_custody_token,
        None,
    )
}
