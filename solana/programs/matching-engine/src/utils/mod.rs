use crate::{error::MatchingEngineError, state::RouterEndpoint};
use anchor_lang::prelude::*;
use wormhole_cctp_solana::wormhole::core_bridge_program::sdk::EmitterInfo;

pub fn verify_router_path(
    src_endpoint: &RouterEndpoint,
    dst_endpoint: &RouterEndpoint,
    emitter_info: &EmitterInfo,
    target_chain: u16,
) -> Result<()> {
    require_eq!(
        src_endpoint.chain,
        emitter_info.chain,
        MatchingEngineError::InvalidEndpoint
    );
    require!(
        src_endpoint.address == emitter_info.address,
        MatchingEngineError::InvalidEndpoint
    );
    require_eq!(
        dst_endpoint.chain,
        target_chain,
        MatchingEngineError::InvalidEndpoint
    );
    require!(
        dst_endpoint.address != [0u8; 32],
        MatchingEngineError::InvalidEndpoint
    );

    Ok(())
}
