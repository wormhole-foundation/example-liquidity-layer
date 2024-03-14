use crate::{
    error::MatchingEngineError,
    processor::admin::router_endpoint::local_token_router::*,
    state::{custodian::*, router_endpoint::*},
    utils,
};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

#[derive(Accounts)]
pub struct UpdateLocalRouterEndpoint<'info> {
    admin: OwnerCustodian<'info>,

    #[account(
        constraint = {
            require_eq!(
                router_endpoint.inner.chain,
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
        &mut ctx.accounts.router_endpoint.inner,
        &ctx.accounts.local.token_router_program,
        &ctx.accounts.local.token_router_emitter,
        &ctx.accounts.local.token_router_mint_recipient,
        None,
    )
}
