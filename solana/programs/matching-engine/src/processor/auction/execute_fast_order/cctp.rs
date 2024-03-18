use crate::{
    error::MatchingEngineError,
    processor::shared_contexts::*,
    state::{Auction, Custodian, MessageProtocol, PayerSequence},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{wormhole_cctp_solana, wormhole_io::TypePrefixedPayload};

/// Accounts required for [execute_fast_order_cctp].
#[derive(Accounts)]
pub struct ExecuteFastOrderCctp<'info> {
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

    /// CHECK: Mutable. Seeds must be \["core-msg", payer, payer_sequence.value\].
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

    /// CHECK: Mutable. Seeds must be \["cctp-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::constants::CCTP_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            payer_sequence.value.to_be_bytes().as_ref(),
        ],
        bump,
    )]
    cctp_message: AccountInfo<'info>,

    custodian: CheckedCustodian<'info>,

    execute_order: ExecuteOrder<'info>,

    wormhole: WormholePublishMessage<'info>,

    cctp: CctpDepositForBurn<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

/// TODO: add docstring
pub fn execute_fast_order_cctp(ctx: Context<ExecuteFastOrderCctp>) -> Result<()> {
    match ctx.accounts.execute_order.to_router_endpoint.protocol {
        MessageProtocol::Cctp { domain } => handle_execute_fast_order_cctp(ctx, domain),
        _ => err!(MatchingEngineError::InvalidCctpEndpoint),
    }
}

pub fn handle_execute_fast_order_cctp(
    ctx: Context<ExecuteFastOrderCctp>,
    destination_cctp_domain: u32,
) -> Result<()> {
    let super::PreparedOrderExecution {
        user_amount: amount,
        fill,
        sequence_seed,
    } = super::prepare_order_execution(super::PrepareFastExecution {
        execute_order: &mut ctx.accounts.execute_order,
        payer_sequence: &mut ctx.accounts.payer_sequence,
        token_program: &ctx.accounts.token_program,
    })?;

    // Send the CCTP message to the destination chain.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .cctp
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: ctx.accounts.execute_order.active_auction.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
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
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                event_authority: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_event_authority
                    .to_account_info(),
            },
            &[
                &[
                    Auction::SEED_PREFIX,
                    ctx.accounts.execute_order.active_auction.vaa_hash.as_ref(),
                    &[ctx.accounts.execute_order.active_auction.bump],
                ],
                &[
                    common::constants::CCTP_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    sequence_seed.as_ref(),
                    &[ctx.bumps.cctp_message],
                ],
            ],
        ),
        CpiContext::new_with_signer(
            ctx.accounts.wormhole.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
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
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: None,
            destination_caller: ctx.accounts.execute_order.to_router_endpoint.address,
            destination_cctp_domain,
            amount,
            mint_recipient: ctx.accounts.execute_order.to_router_endpoint.mint_recipient,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: fill.to_vec_payload(),
        },
    )?;

    Ok(())
}
