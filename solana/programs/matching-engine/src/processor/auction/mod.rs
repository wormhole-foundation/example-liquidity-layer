mod place_initial_offer;
pub use place_initial_offer::*;

mod improve_offer;
pub use improve_offer::*;

mod execute_fast_order;
pub use execute_fast_order::*;

use anchor_lang::prelude::*;

use crate::{error::MatchingEngineError, state::RouterEndpoint};

use wormhole_cctp_solana::wormhole::core_bridge_program::sdk::EmitterInfo;

pub fn verify_router_path(
    from_router_endpoint: &RouterEndpoint,
    to_router_endpoint: &RouterEndpoint,
    emitter_info: &EmitterInfo,
    target_chain: u16,
) -> Result<()> {
    require!(
        from_router_endpoint.chain == emitter_info.chain
            && from_router_endpoint.address == emitter_info.address,
        MatchingEngineError::InvalidEndpoint
    );
    require!(
        to_router_endpoint.chain == target_chain && to_router_endpoint.address != [0u8; 32],
        MatchingEngineError::InvalidEndpoint
    );

    Ok(())
}
