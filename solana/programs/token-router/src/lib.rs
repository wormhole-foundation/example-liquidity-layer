#![doc = include_str!("../README.md")]
#![allow(clippy::result_large_err)]

pub mod cctp_mint_recipient;

mod composite;

mod error;

mod processor;
use processor::*;

pub mod state;

use anchor_lang::prelude::*;

declare_id!(common::constants::TOKEN_ROUTER_PROGRAM_ID);

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

    pub fn prepare_market_order(
        ctx: Context<PrepareMarketOrder>,
        args: PrepareMarketOrderArgs,
    ) -> Result<()> {
        processor::prepare_market_order(ctx, args)
    }

    pub fn close_prepared_order(ctx: Context<ClosePreparedOrder>) -> Result<()> {
        processor::close_prepared_order(ctx)
    }

    pub fn place_market_order_cctp(ctx: Context<PlaceMarketOrderCctp>) -> Result<()> {
        processor::place_market_order_cctp(ctx)
    }

    pub fn redeem_cctp_fill(ctx: Context<RedeemCctpFill>, args: CctpMessageArgs) -> Result<()> {
        processor::redeem_cctp_fill(ctx, args)
    }

    pub fn redeem_fast_fill(ctx: Context<RedeemFastFill>) -> Result<()> {
        processor::redeem_fast_fill(ctx)
    }

    pub fn consume_prepared_fill(ctx: Context<ConsumePreparedFill>) -> Result<()> {
        processor::consume_prepared_fill(ctx)
    }

    // admin

    /// This instruction is be used to generate your program's config.
    /// And for convenience, we will store Wormhole-related PDAs in the
    /// config so we can verify these accounts with a simple == constraint.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        processor::initialize(ctx)
    }

    // /// This instruction is used to transfer native tokens from Solana to a
    // /// foreign blockchain. The user can optionally specify a
    // /// `to_native_token_amount` to swap some of the tokens for the native
    // /// asset on the target chain. For a fee, an off-chain relayer will redeem
    // /// the transfer on the target chain. If the user is transferring native
    // /// SOL, the contract will automatically wrap the lamports into a WSOL.
    // ///
    // /// # Arguments
    // ///
    // /// * `ctx` - `TransferNativeWithRelay` context
    // /// * `amount` - Amount of tokens to send
    // /// * `to_native_token_amount`:
    // ///     - Amount of tokens to swap for native assets on the target chain
    // /// * `recipient_chain` - Chain ID of the target chain
    // /// * `recipient_address` - Address of the target wallet on the target chain
    // /// * `batch_id` - Nonce of Wormhole message
    // /// * `wrap_native` - Whether to wrap native SOL
    // pub fn transfer_tokens_with_relay(
    //     ctx: Context<TransferTokensWithRelay>,
    //     args: TransferTokensWithRelayArgs,
    // ) -> Result<()> {
    //     processor::transfer_tokens_with_relay(ctx, args)
    // }

    // Admin.

    /// This instruction sets the `pending_owner` field in the `OwnerConfig`
    /// account. This instruction is owner-only, meaning that only the owner
    /// of the program (defined in the [Config] account) can submit an
    /// ownership transfer request.
    pub fn submit_ownership_transfer_request(
        ctx: Context<SubmitOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::submit_ownership_transfer_request(ctx)
    }

    /// This instruction confirms that the `pending_owner` is the signer of
    /// the transaction and updates the `owner` field in the `SenderConfig`,
    /// `RedeemerConfig`, and `OwnerConfig` accounts.
    pub fn confirm_ownership_transfer_request(
        ctx: Context<ConfirmOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::confirm_ownership_transfer_request(ctx)
    }

    /// This instruction cancels the ownership transfer request by setting
    /// the `pending_owner` field in the `OwnerConfig` account to `None`.
    /// This instruction is owner-only, meaning that only the owner of the
    /// program (defined in the [Config] account) can cancel an ownership
    /// transfer request.
    pub fn cancel_ownership_transfer_request(
        ctx: Context<CancelOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::cancel_ownership_transfer_request(ctx)
    }

    /// This instruction updates the `assistant` field in the `OwnerConfig`
    /// account. This instruction is owner-only, meaning that only the owner
    /// of the program (defined in the [Config] account) can update the
    /// assistant.
    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    /// This instruction updates the `paused` boolean in the `SenderConfig`
    /// account. This instruction is owner-only, meaning that only the owner
    /// of the program (defined in the [Config] account) can pause outbound
    /// transfers.
    ///
    /// # Arguments
    ///
    /// * `ctx` - `SetPause` context
    /// * `paused` - Boolean indicating whether outbound transfers are paused.
    pub fn set_pause(ctx: Context<SetPause>, paused: bool) -> Result<()> {
        processor::set_pause(ctx, paused)
    }

    // /// This instruction is used to transfer wrapped tokens from Solana to a
    // /// foreign blockchain. The user can optionally specify a
    // /// `to_native_token_amount` to swap some of the tokens for the native
    // /// assets on the target chain. For a fee, an off-chain relayer will redeem
    // /// the transfer on the target chain. This instruction should only be called
    // /// when the user is transferring a wrapped token.
    // ///
    // /// # Arguments
    // ///
    // /// * `ctx` - `TransferWrappedWithRelay` context
    // /// * `amount` - Amount of tokens to send
    // /// * `to_native_token_amount`:
    // ///    - Amount of tokens to swap for native assets on the target chain
    // /// * `recipient_chain` - Chain ID of the target chain
    // /// * `recipient_address` - Address of the target wallet on the target chain
    // /// * `batch_id` - Nonce of Wormhole message
    // pub fn transfer_wrapped_tokens_with_relay(
    //     ctx: Context<TransferWrappedWithRelay>,
    //     amount: u64,
    //     to_native_token_amount: u64,
    //     recipient_chain: u16,
    //     recipient_address: [u8; 32],
    //     batch_id: u32,
    // ) -> Result<()> {
    //     processor::transfer_wrapped_tokens_with_relay(
    //         ctx,
    //         amount,
    //         to_native_token_amount,
    //         recipient_chain,
    //         recipient_address,
    //         batch_id,
    //     )
    // }

    // /// This instruction is used to redeem token transfers from foreign emitters.
    // /// It takes custody of the released native tokens and sends the tokens to the
    // /// encoded `recipient`. It pays the `fee_recipient` in the token
    // /// denomination. If requested by the user, it will perform a swap with the
    // /// off-chain relayer to provide the user with lamports. If the token
    // /// being transferred is WSOL, the contract will unwrap the WSOL and send
    // /// the lamports to the recipient and pay the relayer in lamports.
    // ///
    // /// # Arguments
    // ///
    // /// * `ctx` - `CompleteNativeWithRelay` context
    // /// * `vaa_hash` - Hash of the VAA that triggered the transfer
    // pub fn complete_native_transfer_with_relay(
    //     ctx: Context<CompleteNativeWithRelay>,
    //     _vaa_hash: [u8; 32],
    // ) -> Result<()> {
    //     processor::complete_native_transfer_with_relay(ctx, _vaa_hash)
    // }

    // /// This instruction is used to redeem token transfers from foreign emitters.
    // /// It takes custody of the minted wrapped tokens and sends the tokens to the
    // /// encoded `recipient`. It pays the `fee_recipient` in the wrapped-token
    // /// denomination. If requested by the user, it will perform a swap with the
    // /// off-chain relayer to provide the user with lamports.
    // ///
    // /// # Arguments
    // ///
    // /// * `ctx` - `CompleteWrappedWithRelay` context
    // /// * `vaa_hash` - Hash of the VAA that triggered the transfer
    // pub fn complete_wrapped_transfer_with_relay(
    //     ctx: Context<CompleteWrappedWithRelay>,
    //     _vaa_hash: [u8; 32],
    // ) -> Result<()> {
    //     processor::complete_wrapped_transfer_with_relay(ctx, _vaa_hash)
    // }

    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        processor::migrate(ctx)
    }
}
