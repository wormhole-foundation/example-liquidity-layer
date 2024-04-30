use crate::{
    composite::*,
    utils::{self, admin::AddCctpRouterEndpointArgs},
};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::cctp::token_messenger_minter_program::{
    self, RemoteTokenMessenger,
};

#[derive(Accounts)]
#[instruction(args: AddCctpRouterEndpointArgs)]
pub struct UpdateCctpRouterEndpoint<'info> {
    admin: OwnerOnly<'info>,

    router_endpoint: ExistingMutRouterEndpoint<'info>,

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
    remote_token_messenger: Account<'info, RemoteTokenMessenger>,
}

pub fn update_cctp_router_endpoint(
    ctx: Context<UpdateCctpRouterEndpoint>,
    args: AddCctpRouterEndpointArgs,
) -> Result<()> {
    utils::admin::handle_add_cctp_router_endpoint(&mut ctx.accounts.router_endpoint, args, None)
}
