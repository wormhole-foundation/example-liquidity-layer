pub mod admin;

pub mod auction;

pub(crate) mod wormhole;

use crate::{error::MatchingEngineError, state::RouterEndpoint};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::{VaaAccount, SOLANA_CHAIN};

pub trait VaaDigest {
    fn digest(&self) -> [u8; 32];
}

#[derive(PartialEq, Eq)]
struct WrappedHash([u8; 32]);

impl std::fmt::Display for WrappedHash {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "0x{}", hex::encode(self.0))
    }
}

pub fn require_vaa_hash_equals<A>(ctx: &A, vaa: &VaaAccount) -> Result<bool>
where
    A: VaaDigest,
{
    require_eq!(
        WrappedHash(vaa.digest().0),
        WrappedHash(ctx.digest()),
        MatchingEngineError::InvalidVaa
    );
    Ok(true)
}

pub fn require_local_endpoint(endpoint: &RouterEndpoint) -> Result<bool> {
    require_eq!(
        endpoint.chain,
        SOLANA_CHAIN,
        MatchingEngineError::InvalidEndpoint
    );

    Ok(true)
}
