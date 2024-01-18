#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

pub mod error;

mod processor;
pub(crate) use processor::*;

pub mod state;

pub mod utils;

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

    pub fn redeem_fast_fill(ctx: Context<RedeemFastFill>) -> Result<()> {
        processor::redeem_fast_fill(ctx)
    }

    pub fn execute_slow_order_auction_completed(
        ctx: Context<ExecuteSlowOrderAuctionCompleted>,
        args: CctpMessageArgs,
    ) -> Result<()> {
        processor::execute_slow_order_auction_completed(ctx, args)
    }

    pub fn execute_slow_order_no_auction(
        ctx: Context<ExecuteSlowOrderNoAuction>,
        args: CctpMessageArgs,
    ) -> Result<()> {
        processor::execute_slow_order_no_auction(ctx, args)
    }

    /// This instruction is be used to generate your program's config.
    /// And for convenience, we will store Wormhole-related PDAs in the
    /// config so we can verify these accounts with a simple == constraint.
    pub fn initialize(ctx: Context<Initialize>, auction_config: AuctionConfig) -> Result<()> {
        processor::initialize(ctx, auction_config)
    }

    pub fn add_router_endpoint(
        ctx: Context<AddRouterEndpoint>,
        args: AddRouterEndpointArgs,
    ) -> Result<()> {
        processor::add_router_endpoint(ctx, args)
    }

    pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
        processor::add_local_router_endpoint(ctx)
    }

    pub fn remove_router_endpoint(ctx: Context<RemoveRouterEndpoint>) -> Result<()> {
        processor::remove_router_endpoint(ctx)
    }

    pub fn submit_ownership_transfer_request(
        ctx: Context<SubmitOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::submit_ownership_transfer_request(ctx)
    }

    pub fn confirm_ownership_transfer_request(
        ctx: Context<ConfirmOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::confirm_ownership_transfer_request(ctx)
    }

    pub fn cancel_ownership_transfer_request(
        ctx: Context<CancelOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::cancel_ownership_transfer_request(ctx)
    }

    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
        processor::update_fee_recipient(ctx)
    }

    pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, fee_offer: u64) -> Result<()> {
        processor::place_initial_offer(ctx, fee_offer)
    }

    pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
        processor::improve_offer(ctx, fee_offer)
    }

    pub fn execute_fast_order(ctx: Context<ExecuteFastOrder>) -> Result<()> {
        processor::execute_fast_order(ctx)
    }

    pub fn execute_fast_order_solana(ctx: Context<ExecuteFastOrderSolana>) -> Result<()> {
        processor::execute_fast_order_solana(ctx)
    }
}
