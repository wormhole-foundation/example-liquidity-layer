use crate::{
    error::TokenRouterError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;
use common::admin::utils::assistant::only_authorized;

#[derive(Accounts)]
pub struct RemoveRouterEndpoint<'info> {
    #[account(
        mut,
        constraint = {
            only_authorized(&custodian, &owner_or_assistant.key())
        } @ TokenRouterError::OwnerOrAssistantOnly,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        mut,
        close = owner_or_assistant,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &router_endpoint.chain.to_be_bytes()
        ],
        bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,
}

pub fn remove_router_endpoint(_ctx: Context<RemoveRouterEndpoint>) -> Result<()> {
    // Done.
    Ok(())
}
