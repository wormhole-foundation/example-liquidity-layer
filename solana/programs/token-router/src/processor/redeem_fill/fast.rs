use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerMessage;
use wormhole_cctp_solana::wormhole::core_bridge_program;

/// Account context to invoke [redeem_fast_fill].
#[derive(Accounts)]
pub struct RedeemFastFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

    /// Redeemer, who owns the token account that will receive the minted tokens.
    ///
    /// CHECK: Signer must be the redeemer encoded in the Deposit Fill message.
    redeemer: Signer<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    dst_token: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    /// CHECK: Seeds must be \["emitter"] (Matching Engine program).
    #[account(mut)]
    matching_engine_custodian: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["redeemed", vaa_digest\] (Matching Engine program).
    #[account(mut)]
    matching_engine_redeemed_fast_fill: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["endpoint", SOLANA_CHAIN.to_be_bytes()\] (Matching Engine program).
    matching_engine_router_endpoint: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["custody"] (Matching Engine program).
    #[account(mut)]
    matching_engine_custody_token: UncheckedAccount<'info>,

    matching_engine_program: Program<'info, matching_engine::program::MatchingEngine>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// This instruction reconciles a Wormhole CCTP deposit message with a CCTP message to mint tokens
/// for the [mint_recipient](RedeemFastFill::mint_recipient) token account.
///
/// See [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint) for more details.
pub fn redeem_fast_fill(ctx: Context<RedeemFastFill>) -> Result<()> {
    let custodian_seeds = &[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]];

    matching_engine::cpi::redeem_fast_fill(CpiContext::new_with_signer(
        ctx.accounts.matching_engine_program.to_account_info(),
        matching_engine::cpi::accounts::RedeemFastFill {
            payer: ctx.accounts.payer.to_account_info(),
            custodian: ctx.accounts.matching_engine_custodian.to_account_info(),
            vaa: ctx.accounts.vaa.to_account_info(),
            redeemed_fast_fill: ctx
                .accounts
                .matching_engine_redeemed_fast_fill
                .to_account_info(),
            token_router_emitter: ctx.accounts.custodian.to_account_info(),
            token_router_custody_token: ctx.accounts.custody_token.to_account_info(),
            router_endpoint: ctx
                .accounts
                .matching_engine_router_endpoint
                .to_account_info(),
            custody_token: ctx.accounts.matching_engine_custody_token.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        &[custodian_seeds],
    ))?;

    let vaa =
        wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount::load(&ctx.accounts.vaa)
            .unwrap();

    // Verify redeemer.
    let amount = {
        let fast_fill = LiquidityLayerMessage::try_from(vaa.try_payload().unwrap())
            .unwrap()
            .to_fast_fill_unchecked();

        require_keys_eq!(
            Pubkey::from(fast_fill.fill().redeemer()),
            ctx.accounts.redeemer.key(),
            TokenRouterError::InvalidRedeemer
        );

        // This is safe because we know the amount is within u64 range.
        u64::try_from(fast_fill.amount()).unwrap()
    };

    // Finally transfer tokens to destination.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.dst_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[custodian_seeds],
        ),
        amount,
    )
}
