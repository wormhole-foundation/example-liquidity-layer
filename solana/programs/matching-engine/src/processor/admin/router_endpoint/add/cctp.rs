use crate::{
    error::MatchingEngineError,
    state::{Custodian, MessageProtocol, RouterEndpoint},
};
use anchor_lang::prelude::*;
use common::{
    admin::utils::assistant::only_authorized,
    wormhole_cctp_solana::{
        cctp::token_messenger_minter_program::{self, RemoteTokenMessenger},
        utils::ExternalAccount,
        wormhole::core_bridge_program,
    },
};

#[derive(Accounts)]
#[instruction(chain: u16, cctp_domain: u32)]
pub struct AddCctpRouterEndpoint<'info> {
    #[account(mut)]
    owner_or_assistant: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
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

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    #[account(
        seeds = [
            RemoteTokenMessenger::SEED_PREFIX,
            cctp_domain.to_string().as_ref()
        ],
        bump,
        seeds::program = token_messenger_minter_program::id(),
    )]
    remote_token_messenger: Account<'info, ExternalAccount<RemoteTokenMessenger>>,

    system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddCctpRouterEndpointArgs {
    pub chain: u16,
    pub cctp_domain: u32,
    pub address: [u8; 32],
    pub mint_recipient: Option<[u8; 32]>,
}

pub fn add_cctp_router_endpoint(
    ctx: Context<AddCctpRouterEndpoint>,
    args: AddCctpRouterEndpointArgs,
) -> Result<()> {
    let AddCctpRouterEndpointArgs {
        chain,
        cctp_domain: domain,
        address,
        mint_recipient,
    } = args;

    require!(
        chain != 0 && chain != core_bridge_program::SOLANA_CHAIN,
        MatchingEngineError::ChainNotAllowed
    );

    require!(address != [0; 32], MatchingEngineError::InvalidEndpoint);

    let mint_recipient = match mint_recipient {
        Some(mint_recipient) => {
            require!(
                mint_recipient != [0; 32],
                MatchingEngineError::InvalidMintRecipient
            );
            mint_recipient
        }
        None => address,
    };

    ctx.accounts.router_endpoint.set_inner(RouterEndpoint {
        bump: ctx.bumps.router_endpoint,
        chain,
        address,
        mint_recipient,
        protocol: MessageProtocol::Cctp { domain },
    });

    // Done.
    Ok(())
}
