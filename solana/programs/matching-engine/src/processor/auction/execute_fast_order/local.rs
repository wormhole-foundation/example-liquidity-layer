use crate::{
    composite::*,
    state::{Auction, PayerSequence},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ExecuteFastOrderLocal<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PayerSequence::INIT_SPACE,
        seeds = [
            PayerSequence::SEED_PREFIX,
            payer.key().as_ref()
        ],
        bump,
    )]
    payer_sequence: Account<'info, PayerSequence>,

    /// CHECK: Mutable. Seeds must be \["msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::constants::CORE_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            &payer_sequence.value.to_be_bytes(),
        ],
        bump,
    )]
    core_message: AccountInfo<'info>,

    custodian: CheckedCustodian<'info>,

    #[account(constraint = utils::require_local_endpoint(&execute_order.to_router_endpoint)?)]
    execute_order: ExecuteOrder<'info>,

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
    let super::PreparedOrderExecution {
        user_amount: amount,
        fill,
        sequence_seed,
    } = super::prepare_order_execution(super::PrepareFastExecution {
        execute_order: &mut ctx.accounts.execute_order,
        payer_sequence: &mut ctx.accounts.payer_sequence,
        dst_token: &ctx.accounts.local_custody_token,
        token_program: &ctx.accounts.token_program,
    })?;

    // Publish message via Core Bridge.
    //
    // NOTE: We cannot close the custody account yet because the user needs to be able to retrieve
    // the funds when they complete the fast fill.
    utils::wormhole::post_matching_engine_message(
        utils::wormhole::PostMatchingEngineMessage {
            wormhole: &ctx.accounts.wormhole,
            core_message: &ctx.accounts.core_message,
            custodian: &ctx.accounts.custodian,
            payer: &ctx.accounts.payer,
            system_program: &ctx.accounts.system_program,
            sysvars: &ctx.accounts.sysvars,
        },
        common::messages::FastFill { amount, fill },
        &sequence_seed,
        ctx.bumps.core_message,
    )?;

    // Finally close the account since it is no longer needed.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx
                .accounts
                .execute_order
                .active_auction
                .custody_token
                .to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx
                .accounts
                .execute_order
                .active_auction
                .auction
                .to_account_info(),
        },
        &[&[
            Auction::SEED_PREFIX,
            ctx.accounts.execute_order.active_auction.vaa_hash.as_ref(),
            &[ctx.accounts.execute_order.active_auction.bump],
        ]],
    ))
}
