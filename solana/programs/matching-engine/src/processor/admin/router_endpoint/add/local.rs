use crate::{
    error::MatchingEngineError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;
use common::admin::utils::assistant::only_authorized;
use wormhole_cctp_solana::wormhole::core_bridge_program::SOLANA_CHAIN;

#[derive(Accounts)]
pub struct AddLocalRouterEndpoint<'info> {
    #[account(
        mut,
        constraint = {
            only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
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
            &SOLANA_CHAIN.to_be_bytes()
        ],
        bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    /// CHECK: Must be an executable (the Token Router program), whose ID will be used to derive the
    /// emitter (router endpoint) address.
    #[account(executable)]
    token_router_program: AccountInfo<'info>,

    system_program: Program<'info, System>,
}

pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
    let program_id = &ctx.accounts.token_router_program.key();

    // This PDA address is the router's emitter address, which is used to publish its Wormhole
    // messages.
    let (emitter, _) = Pubkey::find_program_address(&[b"emitter"], program_id);

    ctx.accounts.router_endpoint.set_inner(RouterEndpoint {
        bump: ctx.bumps["router_endpoint"],
        chain: SOLANA_CHAIN,
        address: emitter.to_bytes(),
        mint_recipient: Pubkey::find_program_address(
            &[common::constants::CUSTODY_TOKEN_SEED_PREFIX],
            program_id,
        )
        .0
        .to_bytes(),
    });

    // Done.
    Ok(())
}
