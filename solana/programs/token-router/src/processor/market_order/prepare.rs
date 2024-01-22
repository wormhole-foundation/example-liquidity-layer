use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::{
    error::TokenRouterError,
    state::{OrderType, PreparedOrder, PreparedOrderInfo},
    CUSTODY_TOKEN_BUMP,
};

#[derive(Accounts)]
#[instruction(args: PrepareMarketOrderArgs)]
pub struct PrepareMarketOrder<'info> {
    #[account(mut)]
    payer: Signer<'info>,

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
    #[account(mut)]
    order_token: AccountInfo<'info>,

    #[account(token::mint = common::constants::usdc::id())]
    refund_token: Account<'info, token::TokenAccount>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = CUSTODY_TOKEN_BUMP,
    )]
    custody_token: AccountInfo<'info>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PrepareMarketOrderArgs {
    /// Transfer amount.
    pub amount_in: u64,

    // If provided, amount of tokens expected to be received on the target chain.
    pub min_amount_out: Option<u64>,

    pub target_chain: u16,

    pub redeemer: [u8; 32],

    /// Arbitrary payload, which can be used to encode instructions or data for another network's
    /// smart contract.
    pub redeemer_message: Vec<u8>,
}

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
        info: Box::new(PreparedOrderInfo {
            order_sender: ctx.accounts.order_sender.key(),
            payer: ctx.accounts.payer.key(),
            order_type: OrderType::Market { min_amount_out },
            order_token: ctx.accounts.order_token.key(),
            refund_token: ctx.accounts.refund_token.key(),
            amount_in,
            target_chain,
            redeemer,
        }),
        redeemer_message,
    });

    // Finally transfer amount to custody token account.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.order_token.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.order_sender.to_account_info(),
            },
        ),
        amount_in,
    )
}
