use crate::{
    error::TokenRouterError,
    state::{Custodian, PayerSequence, RouterEndpoint},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_io::TypePrefixedPayload;
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program,
};

/// Account context to invoke [place_market_order_cctp].
#[derive(Accounts)]
pub struct PlaceMarketOrderCctp<'info> {
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

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// Signer who must have the authority (either as the owner or has been delegated authority)
    /// over the `burn_source` token account.
    burn_source_authority: Signer<'info>,

    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(
        mut,
        address = common::constants::usdc::id(),
    )]
    mint: AccountInfo<'info>,

    /// Token account where assets are burned from. The CCTP Token Messenger Minter program will
    /// burn the configured [amount](TransferTokensWithPayloadArgs::amount) from this account.
    ///
    /// CHECK: This account must have delegated authority or be owned by the
    /// [burn_source_authority](Self::burn_source_authority). Its mint must be USDC.
    #[account(
        mut,
        token::mint = mint,
    )]
    burn_source: Account<'info, token::TokenAccount>,

    /// Temporary custody token account. This account will be closed at the end of this instruction.
    /// It just acts as a conduit to allow this program to be the transfer initiator in the CCTP
    /// message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: AccountInfo<'info>,

    /// Registered emitter account representing a foreign Circle Integration emitter. This account
    /// exists only when another CCTP network is registered.
    ///
    /// Seeds must be \["registered_emitter", target_chain.to_be_bytes()\].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = router_endpoint.bump,
        constraint = router_endpoint.cctp_domain.is_some() @ TokenRouterError::InvalidCctpEndpoint,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

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

/// Arguments used to invoke [place_market_order_cctp].
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlaceMarketOrderCctpArgs {
    /// Transfer (burn) amount.
    pub amount_in: u64,

    pub redeemer: [u8; 32],

    /// Arbitrary payload, which can be used to encode instructions or data for another network's
    /// smart contract.
    pub redeemer_message: Vec<u8>,
}

/// This instruction invokes both Wormhole Core Bridge and CCTP Token Messenger Minter programs to
/// emit a Wormhole message associated with a CCTP message.
///
/// See [burn_and_publish](wormhole_cctp_solana::cpi::burn_and_publish) for more details.
#[access_control(check_constraints(&args))]
pub fn place_market_order_cctp(
    ctx: Context<PlaceMarketOrderCctp>,
    args: PlaceMarketOrderCctpArgs,
) -> Result<()> {
    let PlaceMarketOrderCctpArgs {
        amount_in: amount,
        redeemer,
        redeemer_message,
    } = args;

    // Because the transfer initiator in the Circle message is whoever signs to burn assets, we need
    // to transfer assets from the source token account to one that belongs to this program.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.burn_source.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.burn_source_authority.to_account_info(),
            },
        ),
        amount,
    )?;

    let custodian_seeds = &[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]];

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
                src_token: ctx.accounts.custody_token.to_account_info(),
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
            &[custodian_seeds],
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
                custodian_seeds,
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
            burn_source: ctx.accounts.burn_source.key(),
            destination_caller: ctx.accounts.router_endpoint.address,
            destination_cctp_domain: ctx.accounts.router_endpoint.cctp_domain.unwrap(),
            amount,
            mint_recipient: ctx.accounts.router_endpoint.address,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::Fill {
                source_chain: wormhole_cctp_solana::wormhole::core_bridge_program::SOLANA_CHAIN,
                order_sender: ctx.accounts.burn_source_authority.key().to_bytes(),
                redeemer,
                redeemer_message: redeemer_message.into(),
            }
            .to_vec_payload(),
        },
    )?;

    // Done.
    Ok(())
}

fn check_constraints(args: &PlaceMarketOrderCctpArgs) -> Result<()> {
    // Even though CCTP prevents zero amount burns, we prefer to throw an explicit error here.
    require!(args.amount_in > 0, TokenRouterError::ZeroAmount);

    // Cannot send to zero address.
    require!(
        args.redeemer != [0; 32],
        TokenRouterError::RedeemerZeroAddress,
    );

    // Done.
    Ok(())
}
