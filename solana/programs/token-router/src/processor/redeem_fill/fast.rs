use crate::{
    composite::*,
    state::{Custodian, FillType, PreparedFill, PreparedFillInfo},
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token;
use common::{
    messages::raw::{LiquidityLayerMessage, MessageToVec},
    wormhole_cctp_solana::wormhole::VaaAccount,
};

/// Accounts required for [redeem_fast_fill].
#[derive(Accounts)]
pub struct RedeemFastFill<'info> {
    custodian: CheckedCustodian<'info>,

    prepared_fill: InitIfNeededPreparedFill<'info>,

    /// CHECK: Seeds must be \["emitter"] (Matching Engine program).
    #[account(mut)]
    matching_engine_custodian: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["redeemed", vaa_digest\] (Matching Engine program).
    #[account(mut)]
    matching_engine_redeemed_fast_fill: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["endpoint", source_chain.to_be_bytes()\] (Matching Engine program).
    matching_engine_from_endpoint: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["endpoint", SOLANA_CHAIN.to_be_bytes()\] (Matching Engine program).
    matching_engine_to_endpoint: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["local-custody", source_chain.to_be_bytes()\]
    /// (Matching Engine program).
    #[account(mut)]
    matching_engine_local_custody_token: UncheckedAccount<'info>,

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
            payer: ctx.accounts.prepared_fill.payer.to_account_info(),
            custodian: matching_engine::cpi::accounts::CheckedCustodian {
                custodian: ctx.accounts.matching_engine_custodian.to_account_info(),
            },
            fast_fill_vaa: matching_engine::cpi::accounts::LiquidityLayerVaa {
                vaa: ctx.accounts.prepared_fill.fill_vaa.to_account_info(),
            },
            redeemed_fast_fill: ctx
                .accounts
                .matching_engine_redeemed_fast_fill
                .to_account_info(),
            token_router_emitter: ctx.accounts.custodian.to_account_info(),
            token_router_custody_token: ctx.accounts.prepared_fill.custody_token.to_account_info(),
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
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    let vaa = VaaAccount::load_unchecked(&ctx.accounts.prepared_fill.fill_vaa);
    let fast_fill = LiquidityLayerMessage::try_from(vaa.payload())
        .unwrap()
        .to_fast_fill_unchecked();

    let fill = fast_fill.fill();

    {
        let data_len = PreparedFill::compute_size(fill.redeemer_message_len().try_into().unwrap());
        let acc_info: &AccountInfo = ctx.accounts.prepared_fill.as_ref();
        let lamport_diff = Rent::get().map(|rent| {
            rent.minimum_balance(data_len)
                .saturating_sub(acc_info.lamports())
        })?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.prepared_fill.payer.to_account_info(),
                    to: ctx.accounts.prepared_fill.to_account_info(),
                },
            ),
            lamport_diff,
        )?;
        acc_info.realloc(data_len, false)?;
    }

    // Set prepared fill data.
    ctx.accounts
        .prepared_fill
        .prepared_fill
        .set_inner(PreparedFill {
            info: PreparedFillInfo {
                vaa_hash: vaa.digest().0,
                bump: ctx.bumps.prepared_fill.prepared_fill,
                prepared_custody_token_bump: ctx.bumps.prepared_fill.custody_token,
                redeemer: Pubkey::from(fill.redeemer()),
                prepared_by: ctx.accounts.prepared_fill.payer.key(),
                fill_type: FillType::FastFill,
                source_chain: fill.source_chain(),
                order_sender: fill.order_sender(),
            },
            redeemer_message: fill.message_to_vec(),
        });

    // Done.
    Ok(())
}
