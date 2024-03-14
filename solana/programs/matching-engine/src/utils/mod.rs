pub mod admin;

pub mod auction;

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionStatus, RouterEndpoint},
};
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

pub fn is_valid_active_auction(
    config: &AuctionConfig,
    auction: &Auction,
    best_offer_token: Option<Pubkey>,
    initial_offer_token: Option<Pubkey>,
) -> Result<bool> {
    match (&auction.status, &auction.info) {
        (AuctionStatus::Active, Some(info)) => {
            require_eq!(
                info.config_id,
                config.id,
                MatchingEngineError::AuctionConfigMismatch
            );

            if let Some(best_offer_token) = best_offer_token {
                require_keys_eq!(
                    best_offer_token,
                    info.best_offer_token,
                    MatchingEngineError::BestOfferTokenMismatch,
                );
            }

            if let Some(initial_offer_token) = initial_offer_token {
                require_keys_eq!(
                    initial_offer_token,
                    info.initial_offer_token,
                    MatchingEngineError::InitialOfferTokenMismatch,
                );
            }

            Ok(true)
        }
        _ => err!(MatchingEngineError::AuctionNotActive),
    }
}
