use crate::{composite::*, error::MatchingEngineError, utils};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

#[derive(Accounts)]
pub struct UpdateLocalRouterEndpoint<'info> {
    admin: OwnerOnly<'info>,

    #[account(
        constraint = {
            require_eq!(
                router_endpoint.chain,
                SOLANA_CHAIN,
                MatchingEngineError::InvalidChain
            );
            true
        }
    )]
    router_endpoint: ExistingMutRouterEndpoint<'info>,

    local: LocalTokenRouter<'info>,
}

pub fn update_local_router_endpoint(ctx: Context<UpdateLocalRouterEndpoint>) -> Result<()> {
    utils::admin::handle_add_local_router_endpoint(
        &mut ctx.accounts.router_endpoint,
        &ctx.accounts.local.token_router_program,
        &ctx.accounts.local.token_router_emitter,
        &ctx.accounts.local.token_router_mint_recipient,
        None,
    )
}
