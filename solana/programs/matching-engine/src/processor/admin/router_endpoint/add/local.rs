use crate::{composite::*, state::RouterEndpoint, utils};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

#[derive(Accounts)]
pub struct AddLocalRouterEndpoint<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: Admin<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RouterEndpoint::INIT_SPACE,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &SOLANA_CHAIN.to_be_bytes()
        ],
        bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    local: LocalTokenRouter<'info>,

    system_program: Program<'info, System>,
}

pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
    utils::admin::handle_add_local_router_endpoint(
        &mut ctx.accounts.router_endpoint,
        &ctx.accounts.local.token_router_program,
        &ctx.accounts.local.token_router_emitter,
        &ctx.accounts.local.token_router_mint_recipient,
        ctx.bumps.router_endpoint.into(),
    )
}
