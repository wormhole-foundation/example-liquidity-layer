use crate::{
    composite::*,
    error::TokenRouterError,
    state::{OrderType, PreparedOrder, PreparedOrderInfo},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::TRANSFER_AUTHORITY_SEED_PREFIX;
use solana_program::keccak;

/// Accounts required for [prepare_market_order].
#[derive(Accounts)]
#[instruction(args: PrepareMarketOrderArgs)]
pub struct PrepareMarketOrder<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// The auction participant needs to set approval to this PDA if the sender (signer) is not
    /// provided.
    ///
    /// CHECK: Seeds must be \["transfer-authority", prepared_order.key(), args.hash()\].
    #[account(
        seeds = [
            TRANSFER_AUTHORITY_SEED_PREFIX,
            prepared_order.key().as_ref(),
            &args.hash().0,
        ],
        bump,
    )]
    program_transfer_authority: Option<UncheckedAccount<'info>>,

    /// Sender, who has the authority to transfer assets from the sender token account. If this
    /// account is not provided, the program transfer authority account must be some account.
    sender: Option<Signer<'info>>,

    #[account(
        init,
        payer = payer,
        space = PreparedOrder::compute_size(args.redeemer_message.len()),
        constraint = {
            require!(args.amount_in > 0, TokenRouterError::InsufficientAmount);

            // Cannot send to zero address.
            require!(args.redeemer != [0; 32], TokenRouterError::InvalidRedeemer);

            // Max message size. This constraint is enforced on every token router due to Solana's
            // inbound payload size restriction.
            require!(
                args.redeemer_message.len() <= crate::MAX_REDEEMER_MESSAGE_SIZE,
                TokenRouterError::RedeemerMessageTooLarge
            );

            // If provided, validate min amount out.
            if let Some(min_amount_out) = args.min_amount_out {
                require!(
                    min_amount_out <= args.amount_in,
                    TokenRouterError::MinAmountOutTooHigh,
                );
            }

            true
        }
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
    sender_token: Box<Account<'info, token::TokenAccount>>,

    // TODO: Do we add a restriction that the refund token account must be the same owner as the
    // sender token account?
    #[account(
        token::mint = usdc,
    )]
    refund_token: Account<'info, token::TokenAccount>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        init,
        payer = payer,
        token::mint = usdc,
        token::authority = custodian,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: Account<'info, token::TokenAccount>,

    usdc: Usdc<'info>,

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

impl PrepareMarketOrderArgs {
    pub fn hash(&self) -> keccak::Hash {
        match self.min_amount_out {
            Some(min_amount_out) => keccak::hashv(&[
                &self.amount_in.to_be_bytes(),
                &min_amount_out.to_be_bytes(),
                &self.target_chain.to_be_bytes(),
                &self.redeemer,
                &self.redeemer_message,
            ]),
            None => keccak::hashv(&[
                &self.amount_in.to_be_bytes(),
                &self.target_chain.to_be_bytes(),
                &self.redeemer,
                &self.redeemer_message,
            ]),
        }
    }
}

pub fn prepare_market_order(
    ctx: Context<PrepareMarketOrder>,
    args: PrepareMarketOrderArgs,
) -> Result<()> {
    let hashed_args = args.hash();

    let PrepareMarketOrderArgs {
        amount_in,
        min_amount_out,
        target_chain,
        redeemer,
        redeemer_message,
    } = args;

    // Set the values in prepared order account.
    ctx.accounts.prepared_order.set_inner(PreparedOrder {
        info: PreparedOrderInfo {
            order_sender: ctx.accounts.sender_token.owner,
            prepared_by: ctx.accounts.payer.key(),
            order_type: OrderType::Market { min_amount_out },
            src_token: ctx.accounts.sender_token.key(),
            refund_token: ctx.accounts.refund_token.key(),
            target_chain,
            redeemer,
            prepared_custody_token_bump: ctx.bumps.prepared_custody_token,
        },
        redeemer_message,
    });

    // Finally transfer amount to custody token account. We perform exclusive or because we do not
    // want to allow specifying more than one authority.
    match (
        ctx.accounts.sender.as_ref(),
        ctx.accounts.program_transfer_authority.as_ref(),
    ) {
        (Some(sender), None) => token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.sender_token.to_account_info(),
                    to: ctx.accounts.prepared_custody_token.to_account_info(),
                    authority: sender.to_account_info(),
                },
            ),
            amount_in,
        ),
        (None, Some(program_transfer_authority)) => token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.sender_token.to_account_info(),
                    to: ctx.accounts.prepared_custody_token.to_account_info(),
                    authority: program_transfer_authority.to_account_info(),
                },
                &[&[
                    TRANSFER_AUTHORITY_SEED_PREFIX,
                    ctx.accounts.prepared_order.key().as_ref(),
                    &hashed_args.0,
                    &[ctx.bumps.program_transfer_authority.unwrap()],
                ]],
            ),
            amount_in,
        ),
        (None, None) => err!(TokenRouterError::MissingAuthority),
        (Some(_), Some(_)) => err!(TokenRouterError::TooManyAuthorities),
    }
}
