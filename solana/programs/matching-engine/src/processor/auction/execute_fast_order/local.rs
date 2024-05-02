use crate::{composite::*, error::MatchingEngineError, state::Custodian, utils};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ExecuteFastOrderLocal<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: Mutable. Seeds must be \["msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::CORE_MESSAGE_SEED_PREFIX,
            execute_order.active_auction.key().as_ref(),
        ],
        bump,
    )]
    core_message: UncheckedAccount<'info>,

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

    wormhole: WormholePublishMessage<'info>,

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

    let payer = &ctx.accounts.payer;
    let active_auction = &ctx.accounts.execute_order.active_auction;

    // Publish message via Core Bridge.
    //
    // NOTE: We cannot close the custody account yet because the user needs to be able to retrieve
    // the funds when they complete the fast fill.
    utils::wormhole::post_matching_engine_message(
        utils::wormhole::PostMatchingEngineMessage {
            wormhole: &ctx.accounts.wormhole,
            core_message: &ctx.accounts.core_message,
            custodian,
            payer,
            system_program: &ctx.accounts.system_program,
            sysvars: &ctx.accounts.sysvars,
        },
        common::messages::FastFill { amount, fill },
        &active_auction.key(),
        ctx.bumps.core_message,
    )?;

    let auction_custody_token = &active_auction.custody_token;

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
            destination: beneficiary.unwrap_or(payer.to_account_info()),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
