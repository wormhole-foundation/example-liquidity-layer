#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

pub mod constants;

pub mod error;

mod processor;
pub(crate) use processor::*;

pub mod state;
use crate::state::AuctionConfig;

use anchor_lang::prelude::*;

cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        // Placeholder.
        declare_id!("MatchingEngine11111111111111111111111111111");
    } else if #[cfg(feature = "testnet")] {
        // Placeholder.
        declare_id!("MatchingEngine11111111111111111111111111111");
    }
}

#[program]
pub mod matching_engine {
    use super::*;

    /// This instruction is be used to generate your program's config.
    /// And for convenience, we will store Wormhole-related PDAs in the
    /// config so we can verify these accounts with a simple == constraint.
    pub fn initialize(
        ctx: Context<Initialize>,
        auction_config: AuctionConfig,
    ) -> Result<()> {
        processor::initialize(ctx, auction_config)
    }

    pub fn add_router_endpoint(
        ctx: Context<AddRouterEndpoint>,
        args: AddRouterEndpointArgs,
    ) -> Result<()> {
        processor::add_router_endpoint(ctx, args)
    }
}
