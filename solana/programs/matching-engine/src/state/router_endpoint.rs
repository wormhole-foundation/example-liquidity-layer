use std::ops::Deref;

use crate::error::MatchingEngineError;
use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum MessageProtocol {
    None,
    Local {
        program_id: Pubkey,
    },
    Cctp {
        /// CCTP domain, which is how CCTP registers identifies foreign networks.
        domain: u32,
    },
}

#[account]
#[derive(Debug, InitSpace)]
/// Foreign emitter account data.
pub struct RouterEndpoint {
    pub bump: u8,

    /// Emitter chain. Cannot equal `1` (Solana's Chain ID).
    pub chain: u16,

    /// Emitter address. Cannot be zero address.
    pub address: [u8; 32],

    /// Future-proof field in case another network has token accounts to send assets to instead of
    /// sending to the address directly.
    pub mint_recipient: [u8; 32],

    /// Specific message protocol used to move assets.
    pub protocol: MessageProtocol,
}

impl RouterEndpoint {
    pub const SEED_PREFIX: &'static [u8] = b"endpoint";
}

#[derive(Accounts)]
pub(crate) struct ExistingMutRouterEndpoint<'info> {
    #[account(
        mut,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &inner.chain.to_be_bytes()
        ],
        bump = inner.bump,
    )]
    pub inner: Account<'info, RouterEndpoint>,
}

#[derive(Accounts)]
pub struct LiveRouterEndpoint<'info> {
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &inner.chain.to_be_bytes()
        ],
        bump = inner.bump,
        constraint = {
            inner.protocol != MessageProtocol::None
        } @ MatchingEngineError::EndpointDisabled,
    )]
    pub inner: Account<'info, RouterEndpoint>,
}

impl<'info> Deref for LiveRouterEndpoint<'info> {
    type Target = RouterEndpoint;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

#[derive(Accounts)]
pub struct LiveRouterEndpointPair<'info> {
    pub from: LiveRouterEndpoint<'info>,

    #[account(constraint = from.chain != to.chain @ MatchingEngineError::SameEndpoint)]
    pub to: LiveRouterEndpoint<'info>,
}
