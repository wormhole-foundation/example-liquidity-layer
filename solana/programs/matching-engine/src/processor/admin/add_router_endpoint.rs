use crate::{
    error::MatchingEngineError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(chain: u16)]
pub struct AddRouterEndpoint<'info> {
    #[account(
        mut,
        constraint = super::require_owner_or_assistant(&custodian, &owner_or_assistant)?,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
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

#[access_control(check_constraints(&args))]
pub fn add_router_endpoint(
    ctx: Context<AddRouterEndpoint>,
    args: AddRouterEndpointArgs,
) -> Result<()> {
    let AddRouterEndpointArgs { chain, address } = args;

    ctx.accounts.router_endpoint.set_inner(RouterEndpoint {
        bump: ctx.bumps["router_endpoint"],
        chain,
        address,
    });

    // Done.
    Ok(())
}

fn check_constraints(args: &AddRouterEndpointArgs) -> Result<()> {
    require!(
        args.chain != 0,
        MatchingEngineError::ChainNotAllowed
    );

    require!(
        args.address != [0; 32],
        MatchingEngineError::InvalidEndpoint
    );

    // Done.
    Ok(())
}
