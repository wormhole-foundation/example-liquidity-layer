use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Custodian, FastFill},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerMessage;

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteFastOrderLocal<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    execute_order: ExecuteOrder<'info>,

    #[account(
        constraint = {
            require_eq!(
                to_router_endpoint.protocol,
                execute_order.active_auction.target_protocol,
                MatchingEngineError::InvalidEndpoint
            );

            utils::require_local_endpoint(&to_router_endpoint)?
        }
    )]
    to_router_endpoint: LiveRouterEndpoint<'info>,

    #[account(
        init,
        payer = payer,
        space = FastFill::checked_compute_size({
            let vaa = execute_order.fast_vaa.load_unchecked();

            // We can unwrap and convert to FastMarketOrder unchecked because we validate the VAA
            // hash equals the one encoded in the auction account.
            let order = LiquidityLayerMessage::try_from(vaa.payload())
                .unwrap()
                .to_fast_market_order_unchecked();

            // It is safe to convert u32 to usize here.
            order.redeemer_message_len().try_into().unwrap()
        })
        .ok_or(MatchingEngineError::FastFillTooLarge)?,
        seeds = [
            FastFill::SEED_PREFIX,
            execute_order.active_auction.key().as_ref(),
        ],
        bump,
    )]
    fast_fill: Account<'info, FastFill>,

    #[account(
        mut,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            &execute_order.fast_vaa.load_unchecked().emitter_chain().to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    sysvars: RequiredSysvars<'info>,
}

pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
    let custodian = &ctx.accounts.custodian;
    let token_program = &ctx.accounts.token_program;

    let super::PreparedOrderExecution {
        user_amount: amount,
        fill,
        beneficiary,
    } = super::prepare_order_execution(super::PrepareFastExecution {
        execute_order: &mut ctx.accounts.execute_order,
        custodian,
        token_program,
    })?;

    let fast_fill = FastFill::new(ctx.bumps.fast_fill, ctx.accounts.payer.key(), amount, fill);
    emit_cpi!(crate::events::FilledLocalFastOrder {
        fast_fill: ctx.accounts.fast_fill.key(),
        info: fast_fill.info,
        redeemer_message: fast_fill.redeemer_message.clone(),
    });
    ctx.accounts.fast_fill.set_inner(fast_fill);

    let auction_custody_token = &ctx.accounts.execute_order.active_auction.custody_token;

    // Transfer funds to the local custody account.
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: auction_custody_token.to_account_info(),
                to: ctx.accounts.local_custody_token.to_account_info(),
                authority: custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount,
    )?;

    // Finally close the account since it is no longer needed.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: auction_custody_token.to_account_info(),
            destination: beneficiary.unwrap_or(ctx.accounts.payer.to_account_info()),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
