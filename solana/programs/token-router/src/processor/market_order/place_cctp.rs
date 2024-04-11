use crate::{
    composite::*,
    error::TokenRouterError,
    state::{Custodian, PayerSequence, PreparedOrder},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    wormhole_cctp_solana::{
        self,
        cctp::{message_transmitter_program, token_messenger_minter_program},
        wormhole::{core_bridge_program, SOLANA_CHAIN},
    },
    wormhole_io::TypePrefixedPayload,
};

/// Accounts required for [place_market_order_cctp].
#[derive(Accounts)]
pub struct PlaceMarketOrderCctp<'info> {
    /// This account must be the same pubkey as the one who prepared the order.
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: This account must equal the prepared order's `prepared_by` pubkey.
    #[account(
        mut,
        address = prepared_order.prepared_by
    )]
    prepared_by: UncheckedAccount<'info>,

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
    payer_sequence: Box<Account<'info, PayerSequence>>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// Seeds must be \["emitter"\].
    #[account(constraint = !custodian.paused @ TokenRouterError::Paused)]
    custodian: CheckedCustodian<'info>,

    #[account(
        mut,
        close = prepared_by,
    )]
    prepared_order: Box<Account<'info, PreparedOrder>>,

    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(mut)]
    mint: UncheckedAccount<'info>,

    /// Temporary custody token account. This account will be closed at the end of this instruction.
    /// It just acts as a conduit to allow this program to be the transfer initiator in the CCTP
    /// message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_order.key().as_ref(),
        ],
        bump = prepared_order.prepared_custody_token_bump,
    )]
    prepared_custody_token: Box<Account<'info, token::TokenAccount>>,

    /// Registered router endpoint representing a foreign Token Router. This account may have a
    /// CCTP domain encoded if this route is CCTP-enabled. For this instruction, it is required that
    /// [RouterEndpoint::cctp_domain] is `Some(value)`.
    ///
    /// Seeds must be \["registered_emitter", target_chain.to_be_bytes()\].
    #[account(
        seeds = [
            matching_engine::state::RouterEndpoint::SEED_PREFIX,
            router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = router_endpoint.bump,
        seeds::program = matching_engine::id(),
        constraint = {
            require_eq!(
                router_endpoint.chain,
                prepared_order.target_chain,
                TokenRouterError::InvalidTargetRouter,
            );

            true
        }
    )]
    router_endpoint: Box<Account<'info, matching_engine::state::RouterEndpoint>>,

    /// CHECK: Seeds must be \["Bridge"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_bridge_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["core-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::CORE_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            payer_sequence.value.to_be_bytes().as_ref(),
        ],
        bump,
    )]
    core_message: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["cctp-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::CCTP_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            payer_sequence.value.to_be_bytes().as_ref(),
        ],
        bump,
    )]
    cctp_message: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["Sequence"\, custodian] (Wormhole Core Bridge program).
    #[account(mut)]
    core_emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["fee_collector"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_fee_collector: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["sender_authority"\] (CCTP Token Messenger Minter program).
    token_messenger_minter_sender_authority: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    #[account(mut)]
    message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    token_minter: UncheckedAccount<'info>,

    /// Local token account, which this program uses to validate the `mint` used to burn.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    local_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program).
    token_messenger_minter_event_authority: UncheckedAccount<'info>,

    core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: UncheckedAccount<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: UncheckedAccount<'info>,
}

/// This instruction invokes both Wormhole Core Bridge and CCTP Token Messenger Minter programs to
/// emit a Wormhole message associated with a CCTP message.
///
/// See [burn_and_publish](wormhole_cctp_solana::cpi::burn_and_publish) for more details.
pub fn place_market_order_cctp(ctx: Context<PlaceMarketOrderCctp>) -> Result<()> {
    match ctx.accounts.router_endpoint.protocol {
        matching_engine::state::MessageProtocol::Cctp { domain } => {
            handle_place_market_order_cctp(ctx, domain)
        }
        _ => err!(TokenRouterError::InvalidCctpEndpoint),
    }
}

fn handle_place_market_order_cctp(
    ctx: Context<PlaceMarketOrderCctp>,
    destination_cctp_domain: u32,
) -> Result<()> {
    let redeemer_message = std::mem::take(&mut ctx.accounts.prepared_order.redeemer_message);

    let custodian = &ctx.accounts.custodian;
    let payer = &ctx.accounts.payer;
    let prepared_custody_token = &ctx.accounts.prepared_custody_token;
    let token_program = &ctx.accounts.token_program;
    let system_program = &ctx.accounts.system_program;
    let router_endpoint = &ctx.accounts.router_endpoint;

    let order_info = &ctx.accounts.prepared_order.info;
    let sequence_seed = ctx
        .accounts
        .payer_sequence
        .take_and_uptick()
        .map(|seq| seq.to_be_bytes())?;

    // This returns the CCTP nonce, but we do not need it.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: custodian.to_account_info(),
                payer: payer.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                burn_token: prepared_custody_token.to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.token_minter.to_account_info(),
                local_token: ctx.accounts.local_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                cctp_message: ctx.accounts.cctp_message.to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: token_program.to_account_info(),
                system_program: system_program.to_account_info(),
                event_authority: ctx
                    .accounts
                    .token_messenger_minter_event_authority
                    .to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CCTP_MESSAGE_SEED_PREFIX,
                    payer.key().as_ref(),
                    sequence_seed.as_ref(),
                    &[ctx.bumps.cctp_message],
                ],
            ],
        ),
        CpiContext::new_with_signer(
            ctx.accounts.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
                payer: payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: custodian.to_account_info(),
                config: ctx.accounts.core_bridge_config.to_account_info(),
                emitter_sequence: ctx.accounts.core_emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.core_fee_collector.to_account_info(),
                system_program: system_program.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CORE_MESSAGE_SEED_PREFIX,
                    payer.key().as_ref(),
                    sequence_seed.as_ref(),
                    &[ctx.bumps.core_message],
                ],
            ],
        ),
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: Some(order_info.src_token),
            destination_caller: router_endpoint.address,
            destination_cctp_domain,
            amount: prepared_custody_token.amount,
            mint_recipient: router_endpoint.mint_recipient,
            wormhole_message_nonce: common::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::Fill {
                source_chain: SOLANA_CHAIN,
                order_sender: order_info.order_sender.to_bytes(),
                redeemer: order_info.redeemer,
                redeemer_message: redeemer_message.into(),
            }
            .to_vec_payload(),
        },
    )?;

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: prepared_custody_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
