mod local;
pub use local::*;

use crate::{
    error::MatchingEngineError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;
use common::admin::utils::assistant::only_authorized;

#[derive(Accounts)]
#[instruction(chain: u16)]
pub struct AddRouterEndpoint<'info> {
    #[account(mut)]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        constraint = {
            only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        init_if_needed,
        payer = owner_or_assistant,
        space = 8 + RouterEndpoint::INIT_SPACE,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &chain.to_be_bytes()
        ],
        bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddRouterEndpointArgs {
    pub chain: u16,
    pub address: [u8; 32],
}

pub fn add_router_endpoint(
    ctx: Context<AddRouterEndpoint>,
    args: AddRouterEndpointArgs,
) -> Result<()> {
    let AddRouterEndpointArgs { chain, address } = args;

    require!(
        chain != 0 && chain != wormhole_cctp_solana::wormhole::core_bridge_program::SOLANA_CHAIN,
        MatchingEngineError::ChainNotAllowed
    );

    require!(address != [0; 32], MatchingEngineError::InvalidEndpoint);

    ctx.accounts.router_endpoint.set_inner(RouterEndpoint {
        bump: ctx.bumps["router_endpoint"],
        chain,
        address,
    });

    // Done.
    Ok(())
}
