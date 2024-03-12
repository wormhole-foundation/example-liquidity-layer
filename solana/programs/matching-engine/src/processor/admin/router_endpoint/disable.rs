use crate::{
    error::MatchingEngineError,
    state::{Custodian, MessageProtocol, RouterEndpoint},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DisableRouterEndpoint<'info> {
    #[account(mut)]
    owner: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        has_one = owner @ MatchingEngineError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        mut,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &router_endpoint.chain.to_be_bytes()
        ],
        bump = router_endpoint.bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,
}

pub fn disable_router_endpoint(ctx: Context<DisableRouterEndpoint>) -> Result<()> {
    ctx.accounts.router_endpoint.protocol = MessageProtocol::None;

    // Done.
    Ok(())
}
