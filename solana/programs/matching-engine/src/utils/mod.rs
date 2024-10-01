pub mod admin;

pub mod auction;

use crate::{error::MatchingEngineError, state::RouterEndpoint};
use anchor_lang::prelude::*;
use anchor_spl::token;
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

pub fn checked_deserialize_token_account(
    acc_info: &AccountInfo,
    expected_mint: &Pubkey,
) -> Option<Box<token::TokenAccount>> {
    if acc_info.owner != &token::ID {
        None
    } else {
        let data = acc_info.try_borrow_data().ok()?;

        token::TokenAccount::try_deserialize(&mut &data[..])
            .ok()
            .filter(|token_data| &token_data.mint == expected_mint && !token_data.is_frozen())
            .map(Box::new)
    }
}

/// This method is just used out of convenience to return the same event that was emitted so
/// something like `emit_cpi!` can be used on the same event.
pub fn log_emit<E>(event: E) -> E
where
    E: anchor_lang::Event,
{
    emit!(event);
    event
}
