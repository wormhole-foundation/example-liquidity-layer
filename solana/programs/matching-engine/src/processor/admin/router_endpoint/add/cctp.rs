use crate::{
    composite::*,
    state::RouterEndpoint,
    utils::{self, admin::AddCctpRouterEndpointArgs},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_cctp_solana::{
    cctp::token_messenger_minter_program::{self, RemoteTokenMessenger},
    utils::ExternalAccount,
    wormhole::SOLANA_CHAIN,
};

#[derive(Accounts)]
#[instruction(args: AddCctpRouterEndpointArgs)]
pub struct AddCctpRouterEndpoint<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: Admin<'info>,

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

    /// Local router endpoint PDA.
    ///
    /// NOTE: This account may not exist yet. But we need to pass it since it will be the owner of
    /// the local custody token account.
    ///
    /// CHECK: Seeds must be \["endpoint", SOLANA_CHAIN.to_be_bytes()].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &SOLANA_CHAIN.to_be_bytes()
        ],
        bump,
    )]
    local_router_endpoint: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        token::mint = usdc,
        token::authority = local_router_endpoint,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            &args.chain.to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    usdc: Usdc<'info>,

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

    token_program: Program<'info, token::Token>,
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
