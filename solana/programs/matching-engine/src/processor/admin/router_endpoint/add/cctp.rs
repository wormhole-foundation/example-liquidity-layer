use crate::{
    processor::shared_contexts::*,
    state::RouterEndpoint,
    utils::{self, admin::AddCctpRouterEndpointArgs},
};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::{
    cctp::token_messenger_minter_program::{self, RemoteTokenMessenger},
    utils::ExternalAccount,
};

#[derive(Accounts)]
#[instruction(args: AddCctpRouterEndpointArgs)]
pub struct AddCctpRouterEndpoint<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: AdminCustodian<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RouterEndpoint::INIT_SPACE,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &args.chain.to_be_bytes()
        ],
        bump,
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

    system_program: Program<'info, System>,
}

pub fn add_cctp_router_endpoint(
    ctx: Context<AddCctpRouterEndpoint>,
    args: AddCctpRouterEndpointArgs,
) -> Result<()> {
    utils::admin::handle_add_cctp_router_endpoint(
        &mut ctx.accounts.router_endpoint,
        args,
        Some(ctx.bumps.router_endpoint),
    )
}
