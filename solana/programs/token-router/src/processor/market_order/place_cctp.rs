use crate::{
    error::TokenRouterError,
    state::{Custodian, PayerSequence, PreparedOrder},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_cctp_solana::{
    self,
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program,
};

/// Accounts required for [place_market_order_cctp].
#[derive(Accounts)]
pub struct PlaceMarketOrderCctp<'info> {
    /// This account must be the same pubkey as the one who prepared the order.
    #[account(
        mut,
        address = prepared_order.prepared_by @ TokenRouterError::PayerNotPreparer,
    )]
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

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        constraint = !custodian.paused @ TokenRouterError::Paused,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        mut,
        close = payer,
        has_one = order_sender @ TokenRouterError::OrderSenderMismatch,
    )]
    prepared_order: Account<'info, PreparedOrder>,

    /// Signer who must be the same one encoded in the prepared order.
    order_sender: Signer<'info>,

    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(mut)]
    mint: AccountInfo<'info>,

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
    ///
    /// NOTE: In the EVM implementation, if there is no router endpoint then "ErrUnsupportedChain"
    /// error is thrown (whereas here the account would not exist).
    #[account(
        seeds = [
            matching_engine::state::RouterEndpoint::SEED_PREFIX,
            router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = router_endpoint.bump,
        seeds::program = matching_engine::id(),
    )]
    router_endpoint: Account<'info, matching_engine::state::RouterEndpoint>,

    /// CHECK: Seeds must be \["Bridge"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_bridge_config: UncheckedAccount<'info>,

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

    core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
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

    // This returns the CCTP nonce, but we do not need it.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                src_token_owner: ctx.accounts.custodian.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                src_token: ctx.accounts.prepared_custody_token.to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.token_minter.to_account_info(),
                local_token: ctx.accounts.local_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        CpiContext::new_with_signer(
            ctx.accounts.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
                payer: ctx.accounts.payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: ctx.accounts.custodian.to_account_info(),
                config: ctx.accounts.core_bridge_config.to_account_info(),
                emitter_sequence: ctx.accounts.core_emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.core_fee_collector.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::constants::CORE_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    ctx.accounts
                        .payer_sequence
                        .take_and_uptick()
                        .to_be_bytes()
                        .as_ref(),
                    &[ctx.bumps["core_message"]],
                ],
            ],
        ),
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: Some(ctx.accounts.prepared_order.order_token),
            destination_caller: ctx.accounts.router_endpoint.address,
            destination_cctp_domain,
            amount: ctx.accounts.prepared_custody_token.amount,
            mint_recipient: ctx.accounts.router_endpoint.mint_recipient,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::Fill {
                source_chain: wormhole_cctp_solana::wormhole::core_bridge_program::SOLANA_CHAIN,
                order_sender: ctx.accounts.order_sender.key().to_bytes(),
                redeemer: ctx.accounts.prepared_order.redeemer,
                redeemer_message: redeemer_message.into(),
            },
        },
    )?;

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.prepared_custody_token.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx.accounts.custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
