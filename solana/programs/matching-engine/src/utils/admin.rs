use crate::{
    error::MatchingEngineError,
    state::{router_endpoint::*, MessageProtocol},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddCctpRouterEndpointArgs {
    pub chain: u16,
    pub cctp_domain: u32,
    pub address: [u8; 32],
    pub mint_recipient: Option<[u8; 32]>,
}

pub(crate) fn handle_add_cctp_router_endpoint(
    router_endpoint: &mut Account<RouterEndpoint>,
    args: AddCctpRouterEndpointArgs,
    router_endpoint_bump: Option<u8>,
) -> Result<()> {
    let bump = router_endpoint_bump.unwrap_or_else(|| router_endpoint.bump);

    let AddCctpRouterEndpointArgs {
        chain,
        cctp_domain: domain,
        address,
        mint_recipient,
    } = args;

    require!(
        chain != 0 && chain != SOLANA_CHAIN,
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

    router_endpoint.set_inner(RouterEndpoint {
        bump,
        info: EndpointInfo {
            chain,
            address,
            mint_recipient,
            protocol: MessageProtocol::Cctp { domain },
        },
    });

    // Done.
    Ok(())
}

pub(crate) fn handle_add_local_router_endpoint(
    router_endpoint: &mut Account<RouterEndpoint>,
    token_router_program: &UncheckedAccount,
    token_router_emitter: &UncheckedAccount,
    token_router_custody_token: &Account<token::TokenAccount>,
    router_endpoint_bump: Option<u8>,
) -> Result<()> {
    let bump = router_endpoint_bump.unwrap_or_else(|| router_endpoint.bump);

    router_endpoint.set_inner(RouterEndpoint {
        bump,
        info: EndpointInfo {
            chain: SOLANA_CHAIN,
            address: token_router_emitter.key().to_bytes(),
            mint_recipient: token_router_custody_token.key().to_bytes(),
            protocol: crate::state::MessageProtocol::Local {
                program_id: token_router_program.key(),
            },
        },
    });

    Ok(())
}
