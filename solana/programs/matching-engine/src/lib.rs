#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

pub mod cctp_mint_recipient;

pub mod error;

mod processor;
pub(crate) use processor::*;

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

#[program]
pub mod matching_engine {
    use super::*;

    /// Complete a fast fill and transfer funds from the mint recipient
    /// to the token router's custody token account.
    pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
        processor::complete_fast_fill(ctx)
    }

    /// Prepare a slow order response which will subsequently be closed by a settle instruction.
    pub fn prepare_order_response_cctp(
        ctx: Context<PrepareOrderResponseCctp>,
        args: CctpMessageArgs,
    ) -> Result<()> {
        processor::prepare_order_response_cctp(ctx, args)
    }

    /// Settle a completed auction and transfer funds from the mint recipient to the
    /// token account with the best offer.
    pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
        processor::settle_auction_complete(ctx)
    }

    /// Prepare a fill directly.
    pub fn settle_auction_none_cctp(ctx: Context<SettleAuctionNoneCctp>) -> Result<()> {
        processor::settle_auction_none_cctp(ctx)
    }

    /// Prepare a fill directly in which the target network is the same network where the token router resides.
    pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
        processor::settle_auction_none_local(ctx)
    }

    /// Settle an active auction and prepares a fill.
    pub fn settle_auction_active_cctp(ctx: Context<SettleAuctionActiveCctp>) -> Result<()> {
        processor::settle_auction_active_cctp(ctx)
    }

    /// Settle an active auction and prepare a fill in which the target network is the same network where the token router resides.
    pub fn settle_auction_active_local(ctx: Context<SettleAuctionActiveLocal>) -> Result<()> {
        processor::settle_auction_active_local(ctx)
    }

    /// This instruction is be used to generate your program's config.
    /// And for convenience, we will store Wormhole-related PDAs in the
    /// config so we can verify these accounts with a simple == constraint.
    pub fn initialize(ctx: Context<Initialize>, auction_params: AuctionParameters) -> Result<()> {
        processor::initialize(ctx, auction_params)
    }

    /// Add a token router endpoint for a CCTP-enabled chain.
    pub fn add_cctp_router_endpoint(
        ctx: Context<AddCctpRouterEndpoint>,
        args: AddCctpRouterEndpointArgs,
    ) -> Result<()> {
        processor::add_cctp_router_endpoint(ctx, args)
    }

    /// Add a token router in which the endpoint resides on the same network as that of the matching engine.
    pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
        processor::add_local_router_endpoint(ctx)
    }

    /// Disable a token router endpoint.
    pub fn disable_router_endpoint(ctx: Context<DisableRouterEndpoint>) -> Result<()> {
        processor::disable_router_endpoint(ctx)
    }

    /// Update a token router endpoint for a CCTP-enabled chain.
    pub fn update_cctp_router_endpoint(
        ctx: Context<UpdateCctpRouterEndpoint>,
        args: AddCctpRouterEndpointArgs,
    ) -> Result<()> {
        processor::update_cctp_router_endpoint(ctx, args)
    }

    /// Update a token router endpoint that resides on the same network as that of the matching engine.
    pub fn update_local_router_endpoint(ctx: Context<UpdateLocalRouterEndpoint>) -> Result<()> {
        processor::update_local_router_endpoint(ctx)
    }

    /// Submit request to transfer ownership of a token router.
    /// This instruction is owner-only.
    pub fn submit_ownership_transfer_request(
        ctx: Context<SubmitOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::submit_ownership_transfer_request(ctx)
    }

    /// Confirm request to transfer ownership of a token router.
    /// This instruction requires the `custodian` included in the request to
    /// be a pending owner set as part of [`submit_ownership_transfer_request`].
    pub fn confirm_ownership_transfer_request(
        ctx: Context<ConfirmOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::confirm_ownership_transfer_request(ctx)
    }

    /// Cancel request to transfer ownership of a token router.
    pub fn cancel_ownership_transfer_request(
        ctx: Context<CancelOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::cancel_ownership_transfer_request(ctx)
    }

    /// Propose an update to auction parameters.
    pub fn propose_auction_parameters(
        ctx: Context<ProposeAuctionParameters>,
        params: AuctionParameters,
    ) -> Result<()> {
        processor::propose_auction_parameters(ctx, params)
    }

    /// Enact an update to auction parameters. This instruction is owner-only.
    pub fn update_auction_parameters(ctx: Context<UpdateAuctionParameters>) -> Result<()> {
        processor::update_auction_parameters(ctx)
    }

    /// Sets an assistant to the owner. This instruction is owner-only.
    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    /// Update the fee recipient.
    pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
        processor::update_fee_recipient(ctx)
    }

    /// Open an auction for the fulfillment of a fast market order and place an initial offer.
    pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, fee_offer: u64) -> Result<()> {
        processor::place_initial_offer(ctx, fee_offer)
    }

    /// Improve best offer for an auction.
    pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
        processor::improve_offer(ctx, fee_offer)
    }

    /// Execute a fast market order.
    pub fn execute_fast_order_cctp(ctx: Context<ExecuteFastOrderCctp>) -> Result<()> {
        processor::execute_fast_order_cctp(ctx)
    }

    /// Execute a fast market order in which the target network is the same network where the token router resides.
    pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
        processor::execute_fast_order_local(ctx)
    }

    /// Close an open proposal.
    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        processor::close_proposal(ctx)
    }
}
