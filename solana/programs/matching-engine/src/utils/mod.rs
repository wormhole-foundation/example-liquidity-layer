pub mod admin;

pub mod auction;

use crate::{error::MatchingEngineError, state::RouterEndpoint};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::VaaAccount;

pub fn require_valid_router_path(
    vaa: &VaaAccount<'_>,
    source_endpoint: &RouterEndpoint,
    target_endpoint: &RouterEndpoint,
    expected_target_chain: u16,
) -> Result<()> {
    let emitter = vaa.emitter_info();
    require_eq!(
        source_endpoint.chain,
        emitter.chain,
        MatchingEngineError::ErrInvalidSourceRouter
    );
    require!(
        source_endpoint.address == emitter.address,
        MatchingEngineError::ErrInvalidSourceRouter
    );
    require_eq!(
        target_endpoint.chain,
        expected_target_chain,
        MatchingEngineError::ErrInvalidTargetRouter
    );

    Ok(())
}
