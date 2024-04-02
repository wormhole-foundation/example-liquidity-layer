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

const FEE_PRECISION_MAX: u32 = 1_000_000;
const VAA_AUCTION_EXPIRATION_TIME: i64 = 2 * 60 * 60; // 2 hours

#[program]
pub mod matching_engine {
    use super::*;

    /// This instruction is be used to generate the program's `custodian` and `auction_config`
    /// configs. It also reates the `owner` and `fee_recipient` accounts. Finally, it sets the upgrade
    /// authority to the `upgrade_manager_authority`. Upgrades are managed by the `upgrade_manager_program`.
    /// # Arguments
    ///
    /// * `ctx`            - `Initialize` context.
    /// * `auction_params` - The auction parameters, see `auction_config.rs`.
    pub fn initialize(ctx: Context<Initialize>, auction_params: AuctionParameters) -> Result<()> {
        processor::initialize(ctx, auction_params)
    }

    /// This instruction is used to pause or unpause further processing of new auctions. Only the `owner`
    /// or `owner_assistant` can pause the program.
    /// # Arguments
    ///
    /// * `ctx`   - `SetPause` context.
    /// * `pause` - Boolean indicating whether to pause the program.
    pub fn set_pause(ctx: Context<SetPause>, pause: bool) -> Result<()> {
        processor::set_pause(ctx, pause)
    }

    /// This instruction is used to add a new Token Router endpoint from a foreign chain. The endpoint
    /// must be CCTP compatible. This instruction can only be called by the `owner` or `owner_assistant`.
    /// # Arguments
    ///
    /// * `ctx`  - `AddCctpRouterEndpoint` context.
    /// * `args` - The `AddCctpRouterEndpointArgs`, see `admin.rs`.
    pub fn add_cctp_router_endpoint(
        ctx: Context<AddCctpRouterEndpoint>,
        args: AddCctpRouterEndpointArgs,
    ) -> Result<()> {
        processor::add_cctp_router_endpoint(ctx, args)
    }

    /// This instruction is used to add a new Local Router endpoint. Local means that the
    /// Token Router program exists on Solana. This instruction can only be called by the
    /// `owner` or `owner_assistant`.
    /// # Arguments
    ///
    /// * `ctx` - `AddLocalRouterEndpoint` context.
    pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
        processor::add_local_router_endpoint(ctx)
    }

    /// This instruction is used to disable a router endpoint. This instruction does not close the
    /// account, it only sets the `protocol` to `None` and clears the `address` and `mint_recipient`.
    /// This instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `DisableRouterEndpoint` context.
    pub fn disable_router_endpoint(ctx: Context<DisableRouterEndpoint>) -> Result<()> {
        processor::disable_router_endpoint(ctx)
    }

    /// This instruction is used to update a CCTP router endpoint. It allows the caller to change
    /// the `address`, `mint_recipient`, and `domain`. This instruction can only be called by the
    /// `owner`.
    /// # Arguments
    ///
    /// * `ctx`  - `UpdateCctpRouterEndpoint` context.
    /// * `args` - The `AddCctpRouterEndpointArgs`, see `admin.rs`.
    pub fn update_cctp_router_endpoint(
        ctx: Context<UpdateCctpRouterEndpoint>,
        args: AddCctpRouterEndpointArgs,
    ) -> Result<()> {
        processor::update_cctp_router_endpoint(ctx, args)
    }

    /// This instruction is used to update a Local router endpoint. It allows the caller to change
    /// the `address` and `mint_recipient`. This instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `UpdateLocalRouterEndpoint` context.
    pub fn update_local_router_endpoint(ctx: Context<UpdateLocalRouterEndpoint>) -> Result<()> {
        processor::update_local_router_endpoint(ctx)
    }

    /// This instruction sets the `pending_owner` field in the `Custodian` account. This instruction
    /// can only be called by the `owner`. The `pending_owner` address must be valid, meaning it
    /// cannot be the zero address or the current owner.
    /// # Arguments
    ///
    /// * `ctx` - `SubmitOwnershipTransferRequest` context.
    pub fn submit_ownership_transfer_request(
        ctx: Context<SubmitOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::submit_ownership_transfer_request(ctx)
    }

    /// This instruction confirms the ownership transfer request and sets the new `owner` in the
    /// `Custodian` account. This instruction can only be called by the `pending_owner`. The
    /// `pending_owner` must be the same as the `pending_owner` in the `Custodian` account.
    /// # Arguments
    ///
    /// * `ctx` - `ConfirmOwnershipTransferRequest` context.
    pub fn confirm_ownership_transfer_request(
        ctx: Context<ConfirmOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::confirm_ownership_transfer_request(ctx)
    }

    /// This instruction cancels an ownership transfer request by resetting the `pending_owner` field
    /// in the `Custodian` account. This instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `CancelOwnershipTransferRequest` context.
    pub fn cancel_ownership_transfer_request(
        ctx: Context<CancelOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::cancel_ownership_transfer_request(ctx)
    }

    /// This instruction is used to propose new auction parameters. A proposal cannot be enacted
    /// until one epoch has passed. This instruction can only be called by the `owner` or
    /// `owner_assistant`.
    /// # Arguments
    ///
    /// * `ctx`    - `ProposeAuctionParameters` context.
    /// * `params` - The new `AuctionParameters`, see `auction_config.rs`.
    pub fn propose_auction_parameters(
        ctx: Context<ProposeAuctionParameters>,
        params: AuctionParameters,
    ) -> Result<()> {
        processor::propose_auction_parameters(ctx, params)
    }

    /// This instruction is used to enact an existing auction update proposal. It can only be
    /// executed after the `slot_enact_delay` has passed. This instruction can only be called by
    /// the `owner` of the proposal.
    /// # Arguments
    ///
    /// * `ctx` - `UpdateAuctionParameters` context.
    pub fn update_auction_parameters(ctx: Context<UpdateAuctionParameters>) -> Result<()> {
        processor::update_auction_parameters(ctx)
    }

    /// This instruction is used to close an existing proposal by closing the propsal account. This
    /// instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `CloseProposal` context.
    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        processor::close_proposal(ctx)
    }

    /// This instruction is used to update the `owner_assistant` field in the `Custodian` account. This
    /// instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `UpdateOwnerAssistant` context.
    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    /// This instruction is used to update the `fee_recipient` field in the `Custodian` account. This
    /// instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `UpdateFeeRecipient` context.
    pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
        processor::update_fee_recipient(ctx)
    }

    /// This instruction is used for executing logic during an upgrade. This instruction can only be
    /// called by the `upgrade_manager_program`.
    /// # Arguments
    ///
    /// * `ctx` - `Migrate` context.
    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        processor::migrate(ctx)
    }

    /// This instruction is used to create a new auction given a valid `FastMarketOrder` vaa. This
    /// instruction will record information about the auction and transfer funds from the payer to
    /// an auction-specific token custody account. This instruction can be called by anyone.
    /// # Arguments
    ///
    /// * `ctx`       - `PlaceInitialOffer` context.
    /// * `fee_offer` - The fee that the caller is willing to accept in order for fufilling the fast
    ///                 order. This fee is paid in USDC.
    pub fn place_initial_offer(ctx: Context<PlaceInitialOffer>, fee_offer: u64) -> Result<()> {
        processor::place_initial_offer(ctx, fee_offer)
    }

    /// This instruction is used to improve an existing auction offer. The `fee_offer` must be
    /// greater than the current `fee_offer` in the auction. This instruction will revert if the
    /// `fee_offer` is less than the current `fee_offer`. This instruction can be called by anyone.
    /// # Arguments
    ///
    /// * `ctx`       - `ImproveOffer` context.
    /// * `fee_offer` - The fee that the caller is willing to accept in order for fufilling the fast
    ///                order. This fee is paid in USDC.
    pub fn improve_offer(ctx: Context<ImproveOffer>, fee_offer: u64) -> Result<()> {
        processor::improve_offer(ctx, fee_offer)
    }

    /// This instruction is used to execute the fast order after the auction period has ended.
    /// It should be executed before the `grace_period` has ended, otherwise the `highest_bidder`
    /// will incur a penalty. Once executed, a CCTP transfer will be sent to the recipient encoded
    /// in the `FastMarketOrder` VAA on the target chain.
    /// # Arguments
    ///
    /// * `ctx` - `ExecuteFastOrderCctp` context.
    pub fn execute_fast_order_cctp(ctx: Context<ExecuteFastOrderCctp>) -> Result<()> {
        processor::execute_fast_order_cctp(ctx)
    }

    /// This instruction is used to execute the fast order after the auction period has ended.
    /// It should be executed before the `grace_period` has ended, otherwise the `highest_bidder`
    /// will incur a penalty. Once executed, a `fast_fill` VAA will be emitted.
    /// # Arguments
    ///
    /// * `ctx` - `ExecuteFastOrderLocal` context.
    pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
        processor::execute_fast_order_local(ctx)
    }

    /// This instruction is used to complete the fast fill after the `fast_fill` VAA has been
    /// emitted. The Token Router program on Solana will invoke this instruction to complete the
    /// fast fill. Tokens will be deposited into the local endpoint's custody account.
    /// # Arguments
    ///
    /// * `ctx` - `CompleteFastFill` context.
    pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
        processor::complete_fast_fill(ctx)
    }

    /// This instruction is used to prepare the order response for a CCTP transfer. This instruction
    /// will redeem the finalized transfer associated with a particular auction, and deposit the funds
    /// to the `prepared_custody_token` account that is created during execution. This instruction
    /// will create a `PreparedOrderResponse` account that will be used to settle the auction.
    /// # Arguments
    ///
    /// * `ctx` - `PrepareOrderResponseCctp` context.
    pub fn prepare_order_response_cctp(
        ctx: Context<PrepareOrderResponseCctp>,
        args: CctpMessageArgs,
    ) -> Result<()> {
        processor::prepare_order_response_cctp(ctx, args)
    }

    /// This instruction is used to settle the acution after the `FastMarketOrder` has been executed,
    /// and the `PreparedOrderResponse` has been created. This instruction will settle the auction
    /// by transferring the funds from the `prepared_custody_token` account to the `highest_bidder`
    /// account.
    /// # Arguments
    ///
    /// * `ctx` - `SettleAuctionComplete` context.
    pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
        processor::settle_auction_complete(ctx)
    }

    /// This instruction is used to route funds to the `recipient` for a `FastMarketOrder` with
    /// no corresponding auction on Solana. This instruction can be called by anyone, but the
    /// `base_fee` associated with relaying a finalized VAA will be paid to the `fee_recipient`.
    /// This instruction generates a `Fill` message.
    /// # Arguments
    ///
    /// * `ctx` - `SettleAuctionNoneCctp` context.
    pub fn settle_auction_none_cctp(ctx: Context<SettleAuctionNoneCctp>) -> Result<()> {
        processor::settle_auction_none_cctp(ctx)
    }

    /// This instruction is used to settle a `FastMarketOrder` with no corresponding auction. The funds
    /// are routed to the `recipient` on the target chain by executing a CCTP transfer and sending a `Fill`
    /// message. This instruction can be called by anyone, but the `base_fee` associated with relaying a
    /// finalized VAA will be paid to the `fee_recipient`.
    /// # Arguments
    ///
    /// * `ctx` - `SettleAuctionNoneLocal` context.
    pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
        processor::settle_auction_none_local(ctx)
    }

    /// This instruction is used to create the first `AuctionHistory` account, whose PDA is derived
    /// using ID == 0.
    /// # Arguments
    ///
    /// * `ctx` - `CreateFirstAuctionHistory` context.
    pub fn create_first_auction_history(ctx: Context<CreateFirstAuctionHistory>) -> Result<()> {
        processor::create_first_auction_history(ctx)
    }

    /// This instruction is used to create a new `AuctionHistory` account. The PDA is derived using
    /// its ID. A new history account can be created only when the current one is full (number of
    /// entries equals the hard-coded max entries).
    /// # Arguments
    ///
    /// * `ctx` - `CreateNewAuctionHistory` context.
    pub fn create_new_auction_history(ctx: Context<CreateNewAuctionHistory>) -> Result<()> {
        processor::create_new_auction_history(ctx)
    }

    pub fn add_auction_history_entry(ctx: Context<AddAuctionHistoryEntry>) -> Result<()> {
        processor::add_auction_history_entry(ctx)
    }
}
