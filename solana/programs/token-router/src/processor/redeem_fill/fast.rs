use crate::{
    composite::*,
    state::{Custodian, FillType, PreparedFill, PreparedFillInfo, PreparedFillSeeds},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use matching_engine::state::FastFill;

/// Accounts required for [redeem_fast_fill].
#[derive(Accounts)]
pub struct RedeemFastFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    #[account(
        mut,
        seeds = [
            FastFill::SEED_PREFIX,
            &fast_fill.seeds.source_chain.to_be_bytes(),
            &fast_fill.seeds.order_sender,
            &fast_fill.seeds.sequence.to_be_bytes(),
        ],
        bump = fast_fill.seeds.bump,
        seeds::program = matching_engine_program,
    )]
    fast_fill: Box<Account<'info, FastFill>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = PreparedFill::compute_size(fast_fill.redeemer_message.len()),
        seeds = [
            PreparedFill::SEED_PREFIX,
            fast_fill.key().as_ref(),
        ],
        bump,
    )]
    prepared_fill: Box<Account<'info, PreparedFill>>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\, prepared_fill.key()].
    #[account(
        init_if_needed,
        payer = payer,
        token::mint = usdc,
        token::authority = prepared_fill,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_fill.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: Box<Account<'info, token::TokenAccount>>,

    usdc: Usdc<'info>,

    /// CHECK: Seeds must be \["emitter"] (Matching Engine program).
    matching_engine_custodian: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["endpoint", source_chain.to_be_bytes()\] (Matching Engine program).
    matching_engine_from_endpoint: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["endpoint", SOLANA_CHAIN.to_be_bytes()\] (Matching Engine program).
    matching_engine_to_endpoint: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["local-custody", source_chain.to_be_bytes()\]
    /// (Matching Engine program).
    #[account(mut)]
    matching_engine_local_custody_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"] (Matching Engine program).
    matching_engine_event_authority: UncheckedAccount<'info>,

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
    matching_engine::cpi::complete_fast_fill(CpiContext::new_with_signer(
        ctx.accounts.matching_engine_program.to_account_info(),
        matching_engine::cpi::accounts::CompleteFastFill {
            custodian: matching_engine::cpi::accounts::CheckedCustodian {
                custodian: ctx.accounts.matching_engine_custodian.to_account_info(),
            },
            fast_fill: ctx.accounts.fast_fill.to_account_info(),
            token_router_emitter: ctx.accounts.custodian.to_account_info(),
            token_router_custody_token: ctx.accounts.prepared_custody_token.to_account_info(),
            path: matching_engine::cpi::accounts::LiveRouterPath {
                from_endpoint: matching_engine::cpi::accounts::LiveRouterEndpoint {
                    endpoint: ctx.accounts.matching_engine_from_endpoint.to_account_info(),
                },
                to_endpoint: matching_engine::cpi::accounts::LiveRouterEndpoint {
                    endpoint: ctx.accounts.matching_engine_to_endpoint.to_account_info(),
                },
            },
            local_custody_token: ctx
                .accounts
                .matching_engine_local_custody_token
                .to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            event_authority: ctx
                .accounts
                .matching_engine_event_authority
                .to_account_info(),
            program: ctx.accounts.matching_engine_program.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    let redeemer_message = std::mem::take(&mut ctx.accounts.fast_fill.redeemer_message);
    let fast_fill = &ctx.accounts.fast_fill;

    // Set prepared fill data.
    ctx.accounts.prepared_fill.set_inner(PreparedFill {
        seeds: PreparedFillSeeds {
            fill_source: fast_fill.key(),
            bump: ctx.bumps.prepared_fill,
        },
        info: PreparedFillInfo {
            prepared_custody_token_bump: ctx.bumps.prepared_custody_token,
            redeemer: fast_fill.info.redeemer,
            prepared_by: ctx.accounts.payer.key(),
            fill_type: FillType::FastFill,
            source_chain: fast_fill.seeds.source_chain,
            order_sender: fast_fill.seeds.order_sender,
            timestamp: fast_fill.info.timestamp,
        },
        redeemer_message,
    });

    // Done.
    Ok(())
}
