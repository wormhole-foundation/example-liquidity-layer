use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Custodian, MessageProtocol},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{wormhole_cctp_solana, wormhole_io::TypePrefixedPayload};

/// Accounts required for [execute_fast_order_cctp].
#[derive(Accounts)]
pub struct ExecuteFastOrderCctp<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: Mutable. Seeds must be \["core-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::CORE_MESSAGE_SEED_PREFIX,
            execute_order.active_auction.key().as_ref(),
        ],
        bump,
    )]
    core_message: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["cctp-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::CCTP_MESSAGE_SEED_PREFIX,
            execute_order.active_auction.key().as_ref(),
        ],
        bump,
    )]
    cctp_message: UncheckedAccount<'info>,

    custodian: CheckedCustodian<'info>,

    execute_order: ExecuteOrder<'info>,

    #[account(
        constraint = {
            require_eq!(
                to_router_endpoint.protocol,
                execute_order.active_auction.target_protocol,
                MatchingEngineError::InvalidEndpoint
            );

            true
        }
    )]
    to_router_endpoint: LiveRouterEndpoint<'info>,

    wormhole: WormholePublishMessage<'info>,

    cctp: CctpDepositForBurn<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    sysvars: RequiredSysvars<'info>,
}

pub fn execute_fast_order_cctp(ctx: Context<ExecuteFastOrderCctp>) -> Result<()> {
    match ctx.accounts.to_router_endpoint.protocol {
        MessageProtocol::Cctp { domain } => handle_execute_fast_order_cctp(ctx, domain),
        _ => err!(MatchingEngineError::InvalidCctpEndpoint),
    }
}

pub fn handle_execute_fast_order_cctp(
    ctx: Context<ExecuteFastOrderCctp>,
    destination_cctp_domain: u32,
) -> Result<()> {
    let custodian = &ctx.accounts.custodian;
    let token_program = &ctx.accounts.token_program;

    let super::PreparedOrderExecution {
        user_amount: amount,
        fill,
    } = super::prepare_order_execution(super::PrepareFastExecution {
        execute_order: &mut ctx.accounts.execute_order,
        custodian: &ctx.accounts.custodian,
        token_program: &ctx.accounts.token_program,
    })?;

    let active_auction = &ctx.accounts.execute_order.active_auction;
    let auction_custody_token = &active_auction.custody_token;
    let payer = &ctx.accounts.payer;
    let system_program = &ctx.accounts.system_program;

    // Send the CCTP message to the destination chain.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .cctp
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: custodian.to_account_info(),
                payer: payer.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                burn_token: ctx
                    .accounts
                    .execute_order
                    .active_auction
                    .custody_token
                    .to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .cctp
                    .message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.cctp.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.cctp.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.cctp.token_minter.to_account_info(),
                local_token: ctx.accounts.cctp.local_token.to_account_info(),
                mint: ctx.accounts.cctp.mint.to_account_info(),
                cctp_message: ctx.accounts.cctp_message.to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .cctp
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: token_program.to_account_info(),
                system_program: system_program.to_account_info(),
                event_authority: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_event_authority
                    .to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CCTP_MESSAGE_SEED_PREFIX,
                    active_auction.key().as_ref(),
                    &[ctx.bumps.cctp_message],
                ],
            ],
        ),
        CpiContext::new_with_signer(
            ctx.accounts.wormhole.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
                payer: payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: custodian.to_account_info(),
                config: ctx.accounts.wormhole.config.to_account_info(),
                emitter_sequence: ctx.accounts.wormhole.emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.wormhole.fee_collector.to_account_info(),
                system_program: system_program.to_account_info(),
                clock: ctx.accounts.sysvars.clock.to_account_info(),
                rent: ctx.accounts.sysvars.rent.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CORE_MESSAGE_SEED_PREFIX,
                    active_auction.key().as_ref(),
                    &[ctx.bumps.core_message],
                ],
            ],
        ),
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: None,
            destination_caller: ctx.accounts.to_router_endpoint.address,
            destination_cctp_domain,
            amount,
            mint_recipient: ctx.accounts.to_router_endpoint.mint_recipient,
            wormhole_message_nonce: common::WORMHOLE_MESSAGE_NONCE,
            payload: fill.to_vec_payload(),
        },
    )?;

    // Finally close the account since it is no longer needed.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: auction_custody_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
