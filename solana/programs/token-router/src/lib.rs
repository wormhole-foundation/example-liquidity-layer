#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

pub mod cctp_mint_recipient;

mod composite;

mod error;

mod processor;
use processor::*;

pub mod state;

use anchor_lang::prelude::*;

declare_id!(common::TOKEN_ROUTER_PROGRAM_ID);

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        const CUSTODIAN_BUMP: u8 = 255;
    } else if #[cfg(feature = "localnet")] {
        const CUSTODIAN_BUMP: u8 = 253;
    }
}

const PREPARED_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"prepared-custody";

#[program]
pub mod token_router {
    use super::*;

    /// This instruction is be used to generate the program's `custodian` and `auction_config`
    /// configs. It saves the `payer` as the `owner`. Finally, it sets the upgrade
    /// authority to the `upgrade_manager_authority`. Upgrades are managed by the `upgrade_manager_program`.
    /// # Arguments
    ///
    /// * `ctx`            - `Initialize` context.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        processor::initialize(ctx)
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

    /// This instruction is used to update the `owner_assistant` field in the `Custodian` account. This
    /// instruction can only be called by the `owner`.
    /// # Arguments
    ///
    /// * `ctx` - `UpdateOwnerAssistant` context.
    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    /// This instruction is used to pause or unpause further processing of new transfer. Only the `owner`
    /// or `owner_assistant` can pause the program.
    /// # Arguments
    ///
    /// * `ctx`   - `SetPause` context.
    /// * `pause` - Boolean indicating whether to pause the program.
    pub fn set_pause(ctx: Context<SetPause>, paused: bool) -> Result<()> {
        processor::set_pause(ctx, paused)
    }

    /// This instruction is used for executing logic during an upgrade. This instruction can only be
    /// called by the `upgrade_manager_program`.
    /// # Arguments
    ///
    /// * `ctx` - `Migrate` context.
    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        processor::migrate(ctx)
    }

    /// This instruction is used to prepare a `PrepareOrder` account for a market order. The `amount_in`
    /// is transferred from the `source` account to the `prepared_custody_token` account. Anyone
    /// can call this instruction.
    /// # Arguments
    ///
    /// * `ctx` - `PrepareMarketOrder` context.
    /// * `args` - `PreparedMarketOrderArgs` struct, see `prepare.rs` for more info.
    pub fn prepare_market_order(
        ctx: Context<PrepareMarketOrder>,
        args: PrepareMarketOrderArgs,
    ) -> Result<()> {
        processor::prepare_market_order(ctx, args)
    }

    /// This instruction is used to close a `PreparedOrder` account. This allows users to cancel
    /// an outbound transfer in case the order is no longer needed, or they made a mistake
    /// in the order. The `prepared_custody_token` account is closed and the tokens are refunded
    /// to the `refund_token` account. This instruction can only be called by the `order_sender`.
    /// # Arguments
    ///
    /// * `ctx` - `ClosePreparedOrder` context.
    pub fn close_prepared_order(ctx: Context<ClosePreparedOrder>) -> Result<()> {
        processor::close_prepared_order(ctx)
    }

    /// This instruction is used to place a `MarketOrder`. This order type transfers tokens
    /// from Solana to another registered Token Router endpoint on a different chain. This
    /// instruction requires a `prepared_market_order` account to be present. Note: this
    /// is the only order type on the Solana Token Router currently, and does not pass
    /// through the matching engine.
    /// # Arguments
    ///
    /// * `ctx` - `PlaceMarketOrder` context.
    pub fn place_market_order_cctp(ctx: Context<PlaceMarketOrderCctp>) -> Result<()> {
        processor::place_market_order_cctp(ctx)
    }

    /// This instruction is used to redeem a `Fill` VAA and redeem tokens from a CCTP transfer. After
    /// the tokens are minted by the CCTP program, they are transferred to a token custody account.
    /// The `prepared_fill` account is populated with information from the `Fill` vaa. This
    /// This instruction only handles CCTP transfers.
    /// # Arguments
    ///
    /// * `ctx`  - `RedeemCctpFill` context.
    /// * `args` - `CctpMessageArgs` struct, see `redeem_fill/cctp.rs` for more info.
    pub fn redeem_cctp_fill(ctx: Context<RedeemCctpFill>, args: CctpMessageArgs) -> Result<()> {
        processor::redeem_cctp_fill(ctx, args)
    }

    /// This instruction is used to redeem a `FastFill` VAA created by the matching engine. This instruction
    /// performs a cpi call to the matching engine to complete the fast fill. The tokens transferred to the
    /// `prepared_custody_token` account, and a `prepared_fill` account is created. This instruction only
    /// handles fast fills.
    /// # Arguments
    ///
    /// * `ctx` - `RedeemFastFill` context.
    pub fn redeem_fast_fill(ctx: Context<RedeemFastFill>) -> Result<()> {
        processor::redeem_fast_fill(ctx)
    }

    /// This instruction is used to consume a `prepared_fill` account. The tokens are transferred from the
    /// `prepared_custody_token` account to the `dst_token` account. The `prepared_custody_token` account is
    /// closed. This instruction can only be called by the `redeemer` that is saved in the `prepared_fill`.
    /// # Arguments
    ///
    /// * `ctx` - `ConsumePreparedFill` context.
    pub fn consume_prepared_fill(ctx: Context<ConsumePreparedFill>) -> Result<()> {
        processor::consume_prepared_fill(ctx)
    }
}
