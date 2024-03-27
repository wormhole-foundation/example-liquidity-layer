#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

pub mod cctp_mint_recipient;

mod composite;

mod error;

mod processor;
use processor::*;

pub mod state;

pub mod utils;
pub use utils::admin::AddCctpRouterEndpointArgs;

use anchor_lang::prelude::*;

declare_id!(common::constants::MATCHING_ENGINE_PROGRAM_ID);

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        const CUSTODIAN_BUMP: u8 = 254;
    } else if #[cfg(feature = "localnet")] {
        const CUSTODIAN_BUMP: u8 = 254;
    }
}

const AUCTION_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"auction-custody";
const LOCAL_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"local-custody";
const PREPARED_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"prepared-custody";
const TRANSFER_AUTHORITY_SEED_PREFIX: &[u8] = b"transfer-authority";

#[program]
pub mod matching_engine {
    use super::*;

    pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
        processor::complete_fast_fill(ctx)
    }

    pub fn prepare_order_response_cctp(
        ctx: Context<PrepareOrderResponseCctp>,
        args: CctpMessageArgs,
    ) -> Result<()> {
        processor::prepare_order_response_cctp(ctx, args)
    }

    pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
        processor::settle_auction_complete(ctx)
    }

    pub fn settle_auction_none_cctp(ctx: Context<SettleAuctionNoneCctp>) -> Result<()> {
        processor::settle_auction_none_cctp(ctx)
    }

    pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
        processor::settle_auction_none_local(ctx)
    }

    /// This instruction is be used to generate your program's config.
    /// And for convenience, we will store Wormhole-related PDAs in the
    /// config so we can verify these accounts with a simple == constraint.
    pub fn initialize(ctx: Context<Initialize>, auction_params: AuctionParameters) -> Result<()> {
        processor::initialize(ctx, auction_params)
    }

    pub fn add_cctp_router_endpoint(
        ctx: Context<AddCctpRouterEndpoint>,
        args: AddCctpRouterEndpointArgs,
    ) -> Result<()> {
        processor::add_cctp_router_endpoint(ctx, args)
    }

    pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
        processor::add_local_router_endpoint(ctx)
    }

    pub fn disable_router_endpoint(ctx: Context<DisableRouterEndpoint>) -> Result<()> {
        processor::disable_router_endpoint(ctx)
    }

    pub fn update_cctp_router_endpoint(
        ctx: Context<UpdateCctpRouterEndpoint>,
        args: AddCctpRouterEndpointArgs,
    ) -> Result<()> {
        processor::update_cctp_router_endpoint(ctx, args)
    }

    pub fn update_local_router_endpoint(ctx: Context<UpdateLocalRouterEndpoint>) -> Result<()> {
        processor::update_local_router_endpoint(ctx)
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

    pub fn propose_auction_parameters(
        ctx: Context<ProposeAuctionParameters>,
        params: AuctionParameters,
    ) -> Result<()> {
        processor::propose_auction_parameters(ctx, params)
    }

    pub fn update_auction_parameters(ctx: Context<UpdateAuctionParameters>) -> Result<()> {
        processor::update_auction_parameters(ctx)
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

    pub fn execute_fast_order_cctp(ctx: Context<ExecuteFastOrderCctp>) -> Result<()> {
        processor::execute_fast_order_cctp(ctx)
    }

    pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
        processor::execute_fast_order_local(ctx)
    }

    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        processor::close_proposal(ctx)
    }
}
