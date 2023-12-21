use crate::{
    constants::SEED_PREFIX_TMP,
    error::TokenRouterError,
    message::TokenBridgeRelayerMessage,
    state::{ForeignContract, RedeemerConfig, RegisteredAsset},
    token::{spl_token, Token, TokenAccount},
    PostedTokenBridgeRelayerMessage,
};
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use wormhole_anchor_sdk::{token_bridge, wormhole};

use super::{redeem_token, RedeemToken};

#[derive(Accounts)]
#[instruction(vaa_hash: [u8; 32])]
pub struct CompleteWrappedWithRelay<'info> {
    #[account(mut)]
    /// Payer will pay Wormhole fee to transfer tokens and create temporary
    /// token account.
    pub payer: Signer<'info>,

    #[account(
        seeds = [RedeemerConfig::SEED_PREFIX],
        bump
    )]
    /// Redeemer Config account. Acts as the Token Bridge redeemer, which signs
    /// for the complete transfer instruction. Read-only.
    pub config: Box<Account<'info, RedeemerConfig>>,

    #[account(
        mut,
        associated_token::mint = token_bridge_wrapped_mint,
        associated_token::authority = config.fee_recipient
    )]
    /// Fee recipient's token account. Must be an associated token account. Mutable.
    pub fee_recipient_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [
            ForeignContract::SEED_PREFIX,
            &vaa.emitter_chain().to_be_bytes()[..]
        ],
        bump,
        constraint = foreign_contract.verify(&vaa) @ TokenRouterError::InvalidEndpoint
    )]
    /// Foreign Contract account. The registered contract specified in this
    /// account must agree with the target address for the Token Bridge's token
    /// transfer. Read-only.
    pub foreign_contract: Box<Account<'info, ForeignContract>>,

    #[account(mut)]
    /// Token Bridge wrapped mint info. This is the SPL token that will be
    /// bridged from the foreign contract. The wrapped mint PDA must agree
    /// with the native token's metadata in the wormhole message. Mutable.
    pub token_bridge_wrapped_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = token_bridge_wrapped_mint,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    /// CHECK: recipient may differ from payer if a relayer paid for this
    /// transaction. This instruction verifies that the recipient key
    /// passed in this context matches the intended recipient in the vaa.
    pub recipient: AccountInfo<'info>,

    #[account(
        seeds = [RegisteredAsset::SEED_PREFIX, token_bridge_wrapped_mint.key().as_ref()],
        bump
    )]
    // Registered token account for the specified mint. This account stores
    // information about the token. Read-only.
    pub registered_asset: Box<Account<'info, RegisteredAsset>>,

    #[account(
        seeds = [RegisteredAsset::SEED_PREFIX, spl_token::native_mint::ID.as_ref()],
        bump
    )]
    // Registered token account for the native mint. This account stores
    // information about the token and is used for the swap rate. Read-only.
    pub native_registered_token: Box<Account<'info, RegisteredAsset>>,

    #[account(
        init,
        payer = payer,
        seeds = [
            SEED_PREFIX_TMP,
            token_bridge_wrapped_mint.key().as_ref(),
        ],
        bump,
        token::mint = token_bridge_wrapped_mint,
        token::authority = config
    )]
    /// Program's temporary token account. This account is created before the
    /// instruction is invoked to temporarily take custody of the payer's
    /// tokens. When the tokens are finally bridged in, the tokens will be
    /// transferred to the destination token accounts. This account will have
    /// zero balance and can be closed.
    pub tmp_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Token Bridge program's wrapped metadata, which stores info
    /// about the token from its native chain:
    ///   * Wormhole Chain ID
    ///   * Token's native contract address
    ///   * Token's native decimals
    pub token_bridge_wrapped_meta: UncheckedAccount<'info>,

    /// CHECK: Token Bridge config. Read-only.
    pub token_bridge_config: UncheckedAccount<'info>,

    #[account(
        seeds = [
            wormhole::SEED_PREFIX_POSTED_VAA,
            &vaa_hash
        ],
        bump,
        seeds::program = wormhole_program,
        constraint = vaa.data().to() == crate::ID @ TokenRouterError::InvalidTransferToAddress,
        constraint = vaa.data().to_chain() == wormhole::CHAIN_ID_SOLANA @ TokenRouterError::InvalidTransferToChain,
        constraint = vaa.data().token_chain() != wormhole::CHAIN_ID_SOLANA @ TokenRouterError::InvalidTransferTokenChain
    )]
    /// Verified Wormhole message account. The Wormhole program verified
    /// signatures and posted the account data here. Read-only.
    pub vaa: Box<Account<'info, PostedTokenBridgeRelayerMessage>>,

    #[account(
        mut,
        constraint = token_bridge_claim.data_is_empty() @ TokenRouterError::AlreadyRedeemed
    )]
    /// CHECK: Token Bridge claim account. It stores a boolean, whose value
    /// is true if the bridged assets have been claimed. If the transfer has
    /// not been redeemed, this account will not exist yet.
    ///
    /// NOTE: The Token Bridge program's claim account is only initialized when
    /// a transfer is redeemed (and the boolean value `true` is written as
    /// its data).
    ///
    /// The Token Bridge program will automatically fail if this transfer
    /// is redeemed again. But we choose to short-circuit the failure as the
    /// first evaluation of this instruction.
    pub token_bridge_claim: AccountInfo<'info>,

    /// CHECK: Token Bridge foreign endpoint. This account should really be one
    /// endpoint per chain, but the PDA allows for multiple endpoints for each
    /// chain! We store the proper endpoint for the emitter chain.
    pub token_bridge_foreign_endpoint: UncheckedAccount<'info>,

    /// CHECK: Token Bridge custody signer. Read-only.
    pub token_bridge_mint_authority: UncheckedAccount<'info>,

    pub wormhole_program: Program<'info, wormhole::program::Wormhole>,
    pub token_bridge_program: Program<'info, token_bridge::program::TokenBridge>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,

    /// CHECK: Token Bridge program needs rent sysvar.
    pub rent: UncheckedAccount<'info>,
}

pub fn complete_wrapped_transfer_with_relay(
    ctx: Context<CompleteWrappedWithRelay>,
    _vaa_hash: [u8; 32],
) -> Result<()> {
    // The intended recipient must agree with the recipient account.
    let TokenBridgeRelayerMessage::TransferWithRelay {
        target_relayer_fee,
        to_native_token_amount,
        recipient,
    } = *ctx.accounts.vaa.message().data();
    require!(
        ctx.accounts.recipient.key() == Pubkey::from(recipient),
        TokenRouterError::InvalidRecipient
    );

    // Redeem the token transfer to the tmp_token_account.
    token_bridge::complete_transfer_wrapped_with_payload(CpiContext::new_with_signer(
        ctx.accounts.token_bridge_program.to_account_info(),
        token_bridge::CompleteTransferWrappedWithPayload {
            payer: ctx.accounts.payer.to_account_info(),
            config: ctx.accounts.token_bridge_config.to_account_info(),
            vaa: ctx.accounts.vaa.to_account_info(),
            claim: ctx.accounts.token_bridge_claim.to_account_info(),
            foreign_endpoint: ctx.accounts.token_bridge_foreign_endpoint.to_account_info(),
            to: ctx.accounts.tmp_token_account.to_account_info(),
            redeemer: ctx.accounts.config.to_account_info(),
            wrapped_mint: ctx.accounts.token_bridge_wrapped_mint.to_account_info(),
            wrapped_metadata: ctx.accounts.token_bridge_wrapped_meta.to_account_info(),
            mint_authority: ctx.accounts.token_bridge_mint_authority.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            wormhole_program: ctx.accounts.wormhole_program.to_account_info(),
        },
        &[&[
            RedeemerConfig::SEED_PREFIX.as_ref(),
            &[ctx.accounts.config.bump],
        ]],
    ))?;

    redeem_token(
        RedeemToken {
            payer: &ctx.accounts.payer,
            config: &ctx.accounts.config,
            fee_recipient_token_account: &ctx.accounts.fee_recipient_token_account,
            mint: &ctx.accounts.token_bridge_wrapped_mint,
            recipient_token_account: &ctx.accounts.recipient_token_account,
            recipient: &ctx.accounts.recipient,
            registered_asset: &ctx.accounts.registered_asset,
            native_registered_token: &ctx.accounts.native_registered_token,
            tmp_token_account: &ctx.accounts.tmp_token_account,
            token_program: &ctx.accounts.token_program,
            system_program: &ctx.accounts.system_program,
        },
        ctx.accounts.vaa.data().amount(),
        target_relayer_fee,
        to_native_token_amount,
    )
}
