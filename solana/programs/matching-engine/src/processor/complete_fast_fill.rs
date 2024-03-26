use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{RedeemedFastFill, RouterEndpoint},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::LiquidityLayerMessage,
    wormhole_cctp_solana::wormhole::{VaaAccount, SOLANA_CHAIN},
};

/// Accounts required for [complete_fast_fill].
#[derive(Accounts)]
pub struct CompleteFastFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    #[account(
        constraint = {
            // Make sure that this VAA was emitted from the matching engine.
            let vaa = fast_fill_vaa.load_unchecked();
            require_eq!(
                vaa.emitter_chain(),
                SOLANA_CHAIN,
                MatchingEngineError::InvalidEmitterForFastFill
            );
            require_keys_eq!(
                Pubkey::from(vaa.emitter_address()),
                custodian.key(),
                MatchingEngineError::InvalidEmitterForFastFill
            );

            true
        }
    )]
    fast_fill_vaa: LiquidityLayerVaa<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RedeemedFastFill::INIT_SPACE,
        seeds = [
            RedeemedFastFill::SEED_PREFIX,
            VaaAccount::load(&fast_fill_vaa)?.digest().as_ref()
        ],
        bump
    )]
    redeemed_fast_fill: Account<'info, RedeemedFastFill>,

    #[account(address = Pubkey::from(router_endpoint.address))]
    token_router_emitter: Signer<'info>,

    #[account(
        mut,
        token::mint = local_custody_token.mint,
        token::authority = token_router_emitter,
    )]
    token_router_custody_token: Account<'info, token::TokenAccount>,

    #[account(
        constraint = {
            require_eq!(
                router_endpoint.chain,
                SOLANA_CHAIN,
                MatchingEngineError::InvalidEndpoint
            );
            true
        }
    )]
    router_endpoint: LiveRouterEndpoint<'info>,

    #[account(
        mut,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            {
                let vaa = fast_fill_vaa.load_unchecked();
                let msg = LiquidityLayerMessage::try_from(vaa.payload()).unwrap();

                // Is this a fast fill?
                let fast_fill = msg
                    .fast_fill()
                    .ok_or(MatchingEngineError::InvalidPayloadId)?;

                &fast_fill.fill().source_chain().to_be_bytes()
            },
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// TODO: docstring
pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
    let vaa = ctx.accounts.fast_fill_vaa.load_unchecked();

    // Fill redeemed fast fill data.
    ctx.accounts.redeemed_fast_fill.set_inner(RedeemedFastFill {
        bump: ctx.bumps.redeemed_fast_fill,
        vaa_hash: vaa.digest().0,
        sequence: vaa.sequence(),
    });

    let fast_fill = LiquidityLayerMessage::try_from(vaa.payload())
        .unwrap()
        .to_fast_fill_unchecked();

    // Finally transfer to local token router's token account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.local_custody_token.to_account_info(),
                to: ctx.accounts.token_router_custody_token.to_account_info(),
                authority: ctx.accounts.router_endpoint.to_account_info(),
            },
            &[&[
                RouterEndpoint::SEED_PREFIX,
                &ctx.accounts.router_endpoint.chain.to_be_bytes(),
                &[ctx.accounts.router_endpoint.bump],
            ]],
        ),
        fast_fill.amount(),
    )
}
