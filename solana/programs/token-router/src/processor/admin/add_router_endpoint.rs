use crate::{
    error::TokenRouterError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;
use wormhole_cctp_solana::{
    cctp::token_messenger_minter_program::{self, RemoteTokenMessenger},
    utils::ExternalAccount,
};

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

    remote_token_messenger: Option<AccountInfo<'info>>,

    system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddRouterEndpointArgs {
    pub chain: u16,
    pub address: [u8; 32],
    pub cctp_domain: Option<u32>,
}

#[access_control(check_constraints(&ctx, &args))]
pub fn add_router_endpoint(
    ctx: Context<AddRouterEndpoint>,
    args: AddRouterEndpointArgs,
) -> Result<()> {
    let AddRouterEndpointArgs {
        chain,
        address,
        cctp_domain,
    } = args;

    ctx.accounts.router_endpoint.set_inner(RouterEndpoint {
        bump: ctx.bumps["router_endpoint"],
        chain,
        address,
        cctp_domain,
    });

    // Done.
    Ok(())
}

fn check_constraints(ctx: &Context<AddRouterEndpoint>, args: &AddRouterEndpointArgs) -> Result<()> {
    require!(
        args.chain != 0
            && args.chain != wormhole_cctp_solana::wormhole::core_bridge_program::SOLANA_CHAIN,
        TokenRouterError::ChainNotAllowed
    );

    require!(args.address != [0; 32], TokenRouterError::InvalidEndpoint);

    // If the endpoint is a CCTP endpoint, check that there is a CCTP remote token messenger
    // corresponding to the specified CCTP domain.
    if let Some(cctp_domain) = args.cctp_domain {
        let acc_info = ctx
            .accounts
            .remote_token_messenger
            .as_ref()
            .ok_or(TokenRouterError::CctpRemoteTokenMessengerRequired)?;

        // Check that the account derives to the expected.
        let (expected_key, _) = Pubkey::find_program_address(
            &[
                RemoteTokenMessenger::SEED_PREFIX,
                cctp_domain.to_string().as_ref(),
            ],
            &token_messenger_minter_program::id(),
        );
        require_keys_eq!(acc_info.key(), expected_key, ErrorCode::ConstraintSeeds);

        // Now that we re-derived the remote token messenger account using the provided CCTP domain,
        // deserialize and double-check that the domain in the account matches the provided one
        // (which is what we would have done in the account context, but this account is optional so
        // we have to check it here in access control).
        let mut acc_data: &[_] = &acc_info.try_borrow_data()?;
        let expected_cctp_domain =
            ExternalAccount::<RemoteTokenMessenger>::try_deserialize(&mut acc_data)
                .map(|messenger| messenger.domain)?;
        require_eq!(
            cctp_domain,
            expected_cctp_domain,
            TokenRouterError::InvalidCctpEndpoint
        );
    }

    // Done.
    Ok(())
}
