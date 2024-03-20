use crate::{
    error::MatchingEngineError,
    processor::shared_contexts::*,
    state::{Auction, Custodian, PayerSequence},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    wormhole_cctp_solana::wormhole::{core_bridge_program, VaaAccount, SOLANA_CHAIN},
    wormhole_io::TypePrefixedPayload,
};

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
            payer_sequence.value.to_be_bytes().as_ref(),
        ],
        bump,
    )]
    core_message: AccountInfo<'info>,

    custodian: CheckedCustodian<'info>,

    #[account(
        constraint = {
            require_eq!(
                execute_order.to_router_endpoint.chain,
                SOLANA_CHAIN,
                MatchingEngineError::InvalidEndpoint
            );
            true
        }
    )]
    execute_order: ExecuteOrder<'info>,

    wormhole: WormholePublishMessage<'info>,

    /// This local authority PDA is used as the owner of the local custody token account. When the
    /// auction is complete, funds move from the auction custody token account to the local custody
    /// account and is managed by this authority when the Token Router calls the complete fast fill
    /// instruction.
    ///
    /// CHECK: Seeds must be \["local-authority"\, chain].
    #[account(
        seeds = [
            crate::LOCAL_AUTHORITY_SEED_PREFIX,
            VaaAccount::load(&execute_order.fast_vaa)?.emitter_chain().to_be_bytes().as_ref()
        ],
        bump,
    )]
    local_authority: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        token::mint = usdc,
        token::authority = custodian,
        seeds = [local_authority.key().as_ref()],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    usdc: Usdc<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
    let super::PreparedOrderExecution {
        user_amount: amount,
        fill,
        sequence_seed,
    } = super::prepare_order_execution(super::PrepareFastExecution {
        execute_order: &mut ctx.accounts.execute_order,
        payer_sequence: &mut ctx.accounts.payer_sequence,
        token_program: &ctx.accounts.token_program,
    })?;

    // Publish message via Core Bridge.
    //
    // NOTE: We cannot close the custody account yet because the user needs to be able to retrieve
    // the funds when they complete the fast fill.
    core_bridge_program::cpi::post_message(
        CpiContext::new_with_signer(
            ctx.accounts.wormhole.core_bridge_program.to_account_info(),
            core_bridge_program::cpi::PostMessage {
                payer: ctx.accounts.payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: ctx.accounts.custodian.to_account_info(),
                config: ctx.accounts.wormhole.config.to_account_info(),
                emitter_sequence: ctx.accounts.wormhole.emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.wormhole.fee_collector.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::constants::CORE_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    sequence_seed.as_ref(),
                    &[ctx.bumps.core_message],
                ],
            ],
        ),
        core_bridge_program::cpi::PostMessageArgs {
            nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::FastFill { amount, fill }.to_vec_payload(),
            commitment: core_bridge_program::Commitment::Finalized,
        },
    )?;

    let auction_signer_seeds = &[
        Auction::SEED_PREFIX,
        ctx.accounts.execute_order.active_auction.vaa_hash.as_ref(),
        &[ctx.accounts.execute_order.active_auction.bump],
    ];

    // Transfer funds to local custody token account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx
                    .accounts
                    .execute_order
                    .active_auction
                    .custody_token
                    .to_account_info(),
                to: ctx.accounts.local_custody_token.to_account_info(),
                authority: ctx.accounts.execute_order.active_auction.to_account_info(),
            },
            &[auction_signer_seeds],
        ),
        amount,
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
        &[auction_signer_seeds],
    ))
}
