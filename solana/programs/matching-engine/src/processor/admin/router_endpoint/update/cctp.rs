use crate::{
    error::MatchingEngineError,
    state::{Custodian, RouterEndpoint},
    utils::{self, admin::AddCctpRouterEndpointArgs},
};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::{
    cctp::token_messenger_minter_program::{self, RemoteTokenMessenger},
    utils::ExternalAccount,
};

#[derive(Accounts)]
#[instruction(args: AddCctpRouterEndpointArgs)]
pub struct UpdateCctpRouterEndpoint<'info> {
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
            &args.chain.to_be_bytes()
        ],
        bump = router_endpoint.bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    #[account(
        seeds = [
            RemoteTokenMessenger::SEED_PREFIX,
            args.cctp_domain.to_string().as_ref()
        ],
        bump,
        seeds::program = token_messenger_minter_program::id(),
    )]
    remote_token_messenger: Account<'info, ExternalAccount<RemoteTokenMessenger>>,
}

pub fn update_cctp_router_endpoint(
    ctx: Context<UpdateCctpRouterEndpoint>,
    args: AddCctpRouterEndpointArgs,
) -> Result<()> {
    utils::admin::handle_add_cctp_router_endpoint(&mut ctx.accounts.router_endpoint, args, None)
}
