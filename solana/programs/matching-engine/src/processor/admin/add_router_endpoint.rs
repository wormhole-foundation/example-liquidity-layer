use crate::{
    error::MatchingEngineError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;
use common::admin::utils::assistant::only_authorized;

#[derive(Accounts)]
#[instruction(chain: u16)]
pub struct AddRouterEndpoint<'info> {
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
            &chain.to_be_bytes()
        ],
        bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    /// If provided, must be the Token Router program to check its emitter versus what is provided
    /// in the instruction data when the chain ID is Solana's.
    #[account(executable)]
    token_router_program: Option<AccountInfo<'info>>,

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

    // If we are registering Solana's Token Router, we know what the expected emitter is given the
    // Token Router's program ID, so check it here.
    if chain == wormhole_cctp_solana::wormhole::core_bridge_program::SOLANA_CHAIN {
        let token_router_program_id = ctx
            .accounts
            .token_router_program
            .as_ref()
            .ok_or(MatchingEngineError::TokenRouterProgramIdRequired)
            .map(|info| info.key())?;
        let (expected_emitter, _) =
            Pubkey::find_program_address(&[b"emitter"], &token_router_program_id);
        require_keys_eq!(
            Pubkey::from(address),
            expected_emitter,
            MatchingEngineError::InvalidEndpoint
        )
    }

    ctx.accounts.router_endpoint.set_inner(RouterEndpoint {
        bump: ctx.bumps["router_endpoint"],
        chain,
        address,
    });

    // Done.
    Ok(())
}

fn check_constraints(args: &AddRouterEndpointArgs) -> Result<()> {
    require!(args.chain != 0, MatchingEngineError::ChainNotAllowed);

    require!(
        args.address != [0; 32],
        MatchingEngineError::InvalidEndpoint
    );

    // Done.
    Ok(())
}
