use crate::{
    state::{Custodian, FillType, PreparedFill},
    CUSTODIAN_BUMP, CUSTODY_TOKEN_BUMP,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerMessage;
use wormhole_cctp_solana::wormhole::core_bridge_program::{self, VaaAccount};

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
        bump = CUSTODIAN_BUMP,
    )]
    custodian: AccountInfo<'info>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PreparedFill::INIT_SPACE,
        seeds = [
            PreparedFill::SEED_PREFIX,
            VaaAccount::load(&vaa)?.try_digest()?.as_ref(),
        ],
        bump,
    )]
    prepared_fill: Account<'info, PreparedFill>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = CUSTODY_TOKEN_BUMP,
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
    match ctx.accounts.prepared_fill.fill_type {
        FillType::Unset => handle_redeem_fast_fill(ctx),
        _ => super::redeem_fill_noop(),
    }
}

fn handle_redeem_fast_fill(ctx: Context<RedeemFastFill>) -> Result<()> {
    let custodian_seeds = &[Custodian::SEED_PREFIX, &[CUSTODIAN_BUMP]];

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
    let fast_fill = LiquidityLayerMessage::try_from(vaa.try_payload().unwrap())
        .unwrap()
        .to_fast_fill_unchecked();

    let fill = fast_fill.fill();

    // Set prepared fill data.
    ctx.accounts.prepared_fill.set_inner(PreparedFill {
        vaa_hash: vaa.try_digest().unwrap().0,
        bump: ctx.bumps["prepared_fill"],
        redeemer: Pubkey::from(fill.redeemer()),
        payer: ctx.accounts.payer.key(),
        fill_type: FillType::FastFill,
        source_chain: fill.source_chain(),
        order_sender: fill.order_sender(),
        amount: fast_fill.amount(),
    });

    // Done.
    Ok(())
}
