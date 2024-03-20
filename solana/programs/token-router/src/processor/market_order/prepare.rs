use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::{
    error::TokenRouterError,
    state::{Custodian, OrderType, PreparedOrder, PreparedOrderInfo},
};

/// Accounts required for [prepare_market_order].
#[derive(Accounts)]
#[instruction(args: PrepareMarketOrderArgs)]
pub struct PrepareMarketOrder<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// Custodian, but does not need to be deserialized.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: AccountInfo<'info>,

    /// This signer will be encoded in the prepared order. He will also need to be present when
    /// invoking any of the place market order instructions.
    order_sender: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = PreparedOrder::compute_size(args.redeemer_message.len())
    )]
    prepared_order: Account<'info, PreparedOrder>,

    /// Token account where assets are burned from. The CCTP Token Messenger Minter program will
    /// burn the configured [amount](TransferTokensWithPayloadArgs::amount) from this account.
    ///
    /// CHECK: This account must have delegated authority or be owned by the
    /// [burn_source_authority](Self::burn_source_authority). Its mint must be USDC.
    ///
    /// NOTE: This token account must have delegated transfer authority to the custodian prior to
    /// invoking this instruction.
    #[account(mut)]
    src_token: AccountInfo<'info>,

    #[account(token::mint = mint)]
    refund_token: Account<'info, token::TokenAccount>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = custodian,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: Account<'info, token::TokenAccount>,

    /// CHECK: This mint must be USDC.
    #[account(address = common::constants::USDC_MINT)]
    mint: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// Arguments for [prepare_market_order].
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PrepareMarketOrderArgs {
    /// Amount of tokens to transfer.
    pub amount_in: u64,

    /// If provided, minimum amount of tokens to receive in exchange for
    /// [amount_in](Self::amount_in).
    pub min_amount_out: Option<u64>,

    /// The Wormhole chain ID of the network to transfer tokens to.
    pub target_chain: u16,

    /// The address of the redeeming contract on the target chain.
    pub redeemer: [u8; 32],

    /// Arbitrary payload to be sent to the [redeemer](Self::redeemer), which can be used to encode
    /// instructions or data for another network's smart contract.
    pub redeemer_message: Vec<u8>,
}

/// Prepare a market order for the transfer of funds.
pub fn prepare_market_order(
    ctx: Context<PrepareMarketOrder>,
    args: PrepareMarketOrderArgs,
) -> Result<()> {
    let PrepareMarketOrderArgs {
        amount_in,
        min_amount_out,
        target_chain,
        redeemer,
        redeemer_message,
    } = args;

    require!(args.amount_in > 0, TokenRouterError::InsufficientAmount);

    // Cannot send to zero address.
    require!(args.redeemer != [0; 32], TokenRouterError::InvalidRedeemer);

    // If provided, validate min amount out.
    if let Some(min_amount_out) = min_amount_out {
        require!(
            min_amount_out <= amount_in,
            TokenRouterError::MinAmountOutTooHigh,
        );
    }

    // Set the values in prepared order account.
    ctx.accounts.prepared_order.set_inner(PreparedOrder {
        info: PreparedOrderInfo {
            order_sender: ctx.accounts.order_sender.key(),
            prepared_by: ctx.accounts.payer.key(),
            order_type: OrderType::Market { min_amount_out },
            src_token: ctx.accounts.src_token.key(),
            refund_token: ctx.accounts.refund_token.key(),
            target_chain,
            redeemer,
            prepared_custody_token_bump: ctx.bumps.prepared_custody_token,
        },
        redeemer_message,
    });

    // Finally transfer amount to custody token account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.src_token.to_account_info(),
                to: ctx.accounts.prepared_custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount_in,
    )
}
