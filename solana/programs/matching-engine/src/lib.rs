#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

mod composite;

mod error;

mod events;

mod processor;
use processor::*;

pub mod state;

pub mod utils;
pub use utils::admin::AddCctpRouterEndpointArgs;

use anchor_lang::{prelude::*, solana_program::pubkey};

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        declare_id!("mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS");

        const CUSTODIAN_BUMP: u8 = 254;
        const CCTP_MINT_RECIPIENT: Pubkey = pubkey!("6yKmqWarCry3c8ntYKzM4WiS2fVypxLbENE2fP8onJje");
    } else if #[cfg(feature = "localnet")] {
        declare_id!("MatchingEngine11111111111111111111111111111");

        const CUSTODIAN_BUMP: u8 = 254;
        const CCTP_MINT_RECIPIENT: Pubkey = pubkey!("35iwWKi7ebFyXNaqpswd1g9e9jrjvqWPV39nCQPaBbX1");
    }
}

const AUCTION_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"auction-custody";
const LOCAL_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"local-custody";
const PREPARED_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"prepared-custody";

const FEE_PRECISION_MAX: u32 = 1_000_000;
const VAA_AUCTION_EXPIRATION_TIME: i64 = 2 * 60 * 60; // 2 hours
const EXECUTE_FAST_ORDER_LOCAL_ADDITIONAL_GRACE_PERIOD: u64 = 5; // slots

#[program]
pub mod matching_engine {
    use super::*;

    /// This instruction is be used to generate the program's `custodian` and `auction_config`
    /// configs. It also reates the `owner` and `fee_recipient` accounts. Finally, it sets the
    /// upgrade authority to the `upgrade_manager_authority`. Upgrades are managed by the
    /// `upgrade_manager_program`.
    ///
    /// # Arguments
    ///
    /// * `ctx`  - `Initialize` context.
    /// * `args` - Initialize args, which has the initial [AuctionParameters].
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        processor::initialize(ctx, args)
    }

    /// This instruction is used to pause or unpause further processing of new auctions. Only the
    /// `owner` or `owner_assistant` can pause the program.
    ///
    /// # Arguments
    ///
    /// * `ctx`   - `SetPause` context.
    /// * `pause` - Boolean indicating whether to pause the program.
    pub fn set_pause(ctx: Context<SetPause>, pause: bool) -> Result<()> {
        processor::set_pause(ctx, pause)
    }

    /// This instruction is used to add a new Token Router endpoint from a foreign chain. The
    /// endpoint must be CCTP compatible. This instruction can only be called by the `owner` or
    /// `owner_assistant`.
    ///
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
    ///
    /// # Arguments
    ///
    /// * `ctx` - `AddLocalRouterEndpoint` context.
    pub fn add_local_router_endpoint(ctx: Context<AddLocalRouterEndpoint>) -> Result<()> {
        processor::add_local_router_endpoint(ctx)
    }

    /// This instruction is used to disable a router endpoint. This instruction does not close the
    /// account, it only sets the `protocol` to `None` and clears the `address` and
    /// `mint_recipient`. This instruction can only be called by the `owner`.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `DisableRouterEndpoint` context.
    pub fn disable_router_endpoint(ctx: Context<DisableRouterEndpoint>) -> Result<()> {
        processor::disable_router_endpoint(ctx)
    }

    /// This instruction is used to update a CCTP router endpoint. It allows the caller to change
    /// the `address`, `mint_recipient`, and `domain`. This instruction can only be called by the
    /// `owner`.
    ///
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
    ///
    /// # Arguments
    ///
    /// * `ctx` - `UpdateLocalRouterEndpoint` context.
    pub fn update_local_router_endpoint(ctx: Context<UpdateLocalRouterEndpoint>) -> Result<()> {
        processor::update_local_router_endpoint(ctx)
    }

    /// This instruction sets the `pending_owner` field in the `Custodian` account. This instruction
    /// can only be called by the `owner`. The `pending_owner` address must be valid, meaning it
    /// cannot be the zero address or the current owner.
    ///
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
    ///
    /// # Arguments
    ///
    /// * `ctx` - `ConfirmOwnershipTransferRequest` context.
    pub fn confirm_ownership_transfer_request(
        ctx: Context<ConfirmOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::confirm_ownership_transfer_request(ctx)
    }

    /// This instruction cancels an ownership transfer request by resetting the `pending_owner`
    /// field in the `Custodian` account. This instruction can only be called by the `owner`.
    ///
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
    ///
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
    ///
    /// # Arguments
    ///
    /// * `ctx` - `UpdateAuctionParameters` context.
    pub fn update_auction_parameters(ctx: Context<UpdateAuctionParameters>) -> Result<()> {
        processor::update_auction_parameters(ctx)
    }

    /// This instruction is used to close an existing proposal by closing the proposal account. This
    /// instruction can only be called by the `owner` or `owner_assistant`.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `CloseProposal` context.
    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        processor::close_proposal(ctx)
    }

    /// This instruction is used to update the `owner_assistant` field in the `Custodian` account.
    /// This instruction can only be called by the `owner`.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `UpdateOwnerAssistant` context.
    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    /// This instruction is used to update the `fee_recipient` field in the `Custodian` account.
    /// This instruction can only be called by the `owner` or `owner_assistant`.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `UpdateFeeRecipient` context.
    pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
        processor::update_fee_recipient(ctx)
    }

    /// This instruction is used for executing logic during an upgrade. This instruction can only be
    /// called by the `upgrade_manager_program`.
    ///
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
    /// * `ctx`         - `PlaceInitialOfferCctp` context.
    /// * `offer_price` - The fee that the caller is willing to accept in order for fufilling the
    ///                   fast order. This fee is paid in USDC.
    pub fn place_initial_offer_cctp(
        ctx: Context<PlaceInitialOfferCctp>,
        offer_price: u64,
    ) -> Result<()> {
        processor::place_initial_offer_cctp(ctx, offer_price)
    }

    /// This instruction is used to improve an existing auction offer. The `offer_price` must be
    /// greater than the current `offer_price` in the auction. This instruction will revert if the
    /// `offer_price` is less than the current `offer_price`. This instruction can be called by
    /// anyone.
    ///
    /// # Arguments
    ///
    /// * `ctx`         - `ImproveOffer` context.
    /// * `offer_price` - The fee that the caller is willing to accept in order for fufilling the
    ///                   fast order. This fee is paid in USDC.
    pub fn improve_offer(ctx: Context<ImproveOffer>, offer_price: u64) -> Result<()> {
        processor::improve_offer(ctx, offer_price)
    }

    /// This instruction is used to execute the fast order after the auction period has ended.
    /// It should be executed before the `grace_period` has ended, otherwise the best offer will
    /// incur a penalty. Once executed, a CCTP transfer will be sent to the recipient encoded in the
    /// `FastMarketOrder` VAA on the target chain.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `ExecuteFastOrderCctp` context.
    pub fn execute_fast_order_cctp(ctx: Context<ExecuteFastOrderCctp>) -> Result<()> {
        processor::execute_fast_order_cctp(ctx)
    }

    /// This instruction is used to execute the fast order after the auction period has ended.
    /// It should be executed before the `grace_period` has ended, otherwise the best offer will
    /// incur a penalty. Once executed, a `FastFill` account will be created.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `ExecuteFastOrderLocal` context.
    pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
        processor::execute_fast_order_local(ctx)
    }

    /// This instruction is used to complete the fast fill after the `FastFill` account has been
    /// created. The Token Router program on Solana will invoke this instruction to complete the
    /// fast fill, marking it as redeemed. Tokens will be deposited into the local endpoint's
    /// custody account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `CompleteFastFill` context.
    pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
        processor::complete_fast_fill(ctx)
    }

    /// This instruction is used to prepare the order response for a CCTP transfer. This instruction
    /// will redeem the finalized transfer associated with a particular auction, and deposit the
    /// funds to the `prepared_custody_token` account that is created during execution. This
    /// instruction will create a `PreparedOrderResponse` account that will be used to settle the
    /// auction.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `PrepareOrderResponseCctp` context.
    pub fn prepare_order_response_cctp(
        ctx: Context<PrepareOrderResponseCctp>,
        args: CctpMessageArgs,
    ) -> Result<()> {
        processor::prepare_order_response_cctp(ctx, args)
    }

    /// This instruction is used to settle the acution after the `FastMarketOrder` has been
    /// executed, and the `PreparedOrderResponse` has been created. This instruction will settle the
    /// auction by transferring the funds from the `prepared_custody_token` account to the best
    /// offer account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `SettleAuctionComplete` context.
    pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
        processor::settle_auction_complete(ctx)
    }

    /// This instruction is used to route funds to the `recipient` for a `FastMarketOrder` with
    /// no corresponding auction on Solana. This instruction can be called by anyone, but the sum of
    /// `init_auction_fee` and `base_fee` associated with relaying a finalized VAA will be paid to
    /// the `fee_recipient`. This instruction generates a `Fill` message.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `SettleAuctionNoneCctp` context.
    pub fn settle_auction_none_cctp(ctx: Context<SettleAuctionNoneCctp>) -> Result<()> {
        processor::settle_auction_none_cctp(ctx)
    }

    /// This instruction is used to settle a `FastMarketOrder` with no corresponding auction. This
    /// instruction can be called by anyone, but the sum of `init_auction_fee` and `base_fee`
    /// associated with relaying a finalized VAA will be paid to the `fee_recipient`. This
    /// instruction creates a `FastFill` account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `SettleAuctionNoneLocal` context.
    pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
        processor::settle_auction_none_local(ctx)
    }

    /// This instruction is used to create the first `AuctionHistory` account, whose PDA is derived
    /// using ID == 0.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `CreateFirstAuctionHistory` context.
    pub fn create_first_auction_history(ctx: Context<CreateFirstAuctionHistory>) -> Result<()> {
        processor::create_first_auction_history(ctx)
    }

    /// This instruction is used to create a new `AuctionHistory` account. The PDA is derived using
    /// its ID. A new history account can be created only when the current one is full (number of
    /// entries equals the hard-coded max entries).
    ///
    /// # Arguments
    ///
    /// * `ctx` - `CreateNewAuctionHistory` context.
    pub fn create_new_auction_history(ctx: Context<CreateNewAuctionHistory>) -> Result<()> {
        processor::create_new_auction_history(ctx)
    }

    /// This instruction is used to add a new entry to the `AuctionHistory` account if there is an
    /// `Auction` with some info. Regardless of whether there is info in this account, the
    /// instruction finishes its operation by closing this auction account. If the history account
    /// is full, this instruction will revert and `create_new_auction_history`` will have to be
    /// called to initialize another history account.
    ///
    /// This mechanism is important for auction participants. The initial offer participant will
    /// pay lamports to create the `Auction` account. This instruction allows him to reclaim some
    /// lamports by closing that account. And the protocol's fee recipient will be able to claim
    /// lamports by closing the empty `Auction` account it creates when he calls any of the
    /// `settle_auction_none_*` instructions.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `AddAuctionHistoryEntry` context.
    pub fn add_auction_history_entry(ctx: Context<AddAuctionHistoryEntry>) -> Result<()> {
        processor::add_auction_history_entry(ctx)
    }

    /// This instruction is used to reserve a sequence number for a fast fill. Fast fills are orders
    /// that have been fulfilled and are destined for Solana and are seeded by source chain, order
    /// sender and sequence number (similar to how Wormhole VAAs are identified by emitter chain,
    /// emitter address and sequence number).
    ///
    /// Prior to executing `execute_fast_order_local` after the duration of an auction, the winning
    /// auction participant should call this instruction to reserve the fast fill's sequence number.
    /// This sequence number is warehoused in the `ReservedFastFillSequence` account and will be
    /// closed when the order is executed.
    ///
    /// Auction participants can listen to the `FastFillSequenceReserved` event to track when he
    /// (or associated payer) called this instruction so he can execute local orders easily.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `ReserveFastFillSequenceActiveAuction` context.
    pub fn reserve_fast_fill_sequence_active_auction(
        ctx: Context<ReserveFastFillSequenceActiveAuction>,
    ) -> Result<()> {
        processor::reserve_fast_fill_sequence_active_auction(ctx)
    }
    /// This instruction is used to reserve a sequence number for a fast fill. Fast fills are orders
    /// that have been fulfilled and are destined for Solana and are seeded by source chain, order
    /// sender and sequence number (similar to how Wormhole VAAs are identified by emitter chain,
    /// emitter address and sequence number).
    ///
    /// Prior to executing `settle_auction_none_local` if there is no auction, whomever prepared the
    /// order response should call this instruction to reserve the fast fill's sequence number.
    /// This sequence number is warehoused in the `ReservedFastFillSequence` account and will be
    /// closed when the funds are finally settled.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `ReserveFastFillSequenceNoAuction` context.
    pub fn reserve_fast_fill_sequence_no_auction(
        ctx: Context<ReserveFastFillSequenceNoAuction>,
    ) -> Result<()> {
        processor::reserve_fast_fill_sequence_no_auction(ctx)
    }

    /// This instruction is used to return lamports to the creator of the `FastFill` account only
    /// when this fill was redeemed via the Token Router program.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `CloseRedeemedFastFill` context.
    pub fn close_redeemed_fast_fill(ctx: Context<CloseRedeemedFastFill>) -> Result<()> {
        processor::close_redeemed_fast_fill(ctx)
    }
}

#[cfg(test)]
mod test {
    use solana_program::pubkey::Pubkey;

    #[test]
    fn test_ata_address() {
        let custodian =
            Pubkey::create_program_address(crate::state::Custodian::SIGNER_SEEDS, &crate::id())
                .unwrap();
        assert_eq!(
            super::CCTP_MINT_RECIPIENT,
            anchor_spl::associated_token::get_associated_token_address(
                &custodian,
                &common::USDC_MINT,
            ),
            "custody ata mismatch"
        );
    }
}
