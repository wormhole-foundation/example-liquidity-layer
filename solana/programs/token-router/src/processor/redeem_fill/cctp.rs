use crate::{
    composite::*,
    error::TokenRouterError,
    state::{Custodian, FillType, PreparedFill, PreparedFillInfo, PreparedFillSeeds},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::{LiquidityLayerDepositMessage, LiquidityLayerMessage, MessageToVec},
    wormhole_cctp_solana::{
        self,
        cctp::{message_transmitter_program, token_messenger_minter_program},
        cpi::ReceiveMessageArgs,
    },
};

#[derive(Accounts)]
struct CctpReceiveMessage<'info> {
    mint_recipient: CctpMintRecipientMut<'info>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    message_transmitter_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    used_nonces: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Message Transmitter program)).
    message_transmitter_event_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    token_minter: UncheckedAccount<'info>,

    /// Token Messenger Minter's Local Token account. This program uses the mint of this account to
    /// validate the `mint_recipient` token account's mint.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    local_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_pair", remote_domain.to_string(), remote_token_address\] (CCTP
    /// Token Messenger Minter program).
    token_pair: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["custody", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    token_messenger_minter_custody_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program).
    token_messenger_minter_event_authority: UncheckedAccount<'info>,

    /// CHECK: Must equal CCTP Token Messenger Minter program ID.
    #[account(address = token_messenger_minter_program::id())]
    token_messenger_minter_program: UncheckedAccount<'info>,

    /// CHECK: Must equal CCTP Message Transmitter program ID.
    #[account(address = message_transmitter_program::id())]
    message_transmitter_program: UncheckedAccount<'info>,
}

/// Accounts required for [redeem_cctp_fill].
#[derive(Accounts)]
pub struct RedeemCctpFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    fill_vaa: LiquidityLayerVaa<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = try_compute_prepared_fill_size(&fill_vaa)?,
        seeds = [
            PreparedFill::SEED_PREFIX,
            fill_vaa.key().as_ref(),
        ],
        bump,
    )]
    prepared_fill: Account<'info, PreparedFill>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\, prepared_fill.key()].
    #[account(
        init_if_needed,
        payer = payer,
        token::mint = usdc,
        token::authority = prepared_fill,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_fill.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: Account<'info, token::TokenAccount>,

    usdc: Usdc<'info>,

    /// Registered emitter account representing a Circle Integration on another network.
    ///
    /// Seeds must be \["registered_emitter", target_chain.to_be_bytes()\].
    #[account(
        constraint = {
            // Validate that this message originated from a registered emitter.
            let emitter = fill_vaa.load_unchecked().emitter_info();
            require_eq!(
                emitter.chain,
                source_router_endpoint.chain,
                TokenRouterError::InvalidSourceRouter
            );
            require!(
                emitter.address == source_router_endpoint.address,
                TokenRouterError::InvalidSourceRouter
            );

            true
        }
    )]
    source_router_endpoint: RegisteredEndpoint<'info>,

    cctp: CctpReceiveMessage<'info>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// Arguments for [redeem_cctp_fill].
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CctpMessageArgs {
    /// CCTP message.
    pub encoded_cctp_message: Vec<u8>,

    /// Attestation of [encoded_cctp_message](Self::encoded_cctp_message).
    pub cctp_attestation: Vec<u8>,
}

/// This instruction reconciles a Wormhole CCTP deposit message with a CCTP message to mint tokens
/// for the [mint_recipient](RedeemCctpFill::mint_recipient) token account.
///
/// See [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint) for more details.
pub fn redeem_cctp_fill(ctx: Context<RedeemCctpFill>, args: CctpMessageArgs) -> Result<()> {
    match ctx.accounts.prepared_fill.fill_type {
        FillType::Unset => handle_redeem_fill_cctp(ctx, args),
        _ => super::redeem_fill_noop(),
    }
}

fn handle_redeem_fill_cctp(ctx: Context<RedeemCctpFill>, args: CctpMessageArgs) -> Result<()> {
    let vaa = wormhole_cctp_solana::cpi::verify_vaa_and_mint(
        &ctx.accounts.fill_vaa,
        CpiContext::new_with_signer(
            ctx.accounts
                .cctp
                .message_transmitter_program
                .to_account_info(),
            message_transmitter_program::cpi::ReceiveTokenMessengerMinterMessage {
                payer: ctx.accounts.payer.to_account_info(),
                caller: ctx.accounts.custodian.to_account_info(),
                message_transmitter_authority: ctx
                    .accounts
                    .cctp
                    .message_transmitter_authority
                    .to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .cctp
                    .message_transmitter_config
                    .to_account_info(),
                used_nonces: ctx.accounts.cctp.used_nonces.to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_program
                    .to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                message_transmitter_event_authority: ctx
                    .accounts
                    .cctp
                    .message_transmitter_event_authority
                    .to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .cctp
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger: ctx.accounts.cctp.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.cctp.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.cctp.token_minter.to_account_info(),
                local_token: ctx.accounts.cctp.local_token.to_account_info(),
                token_pair: ctx.accounts.cctp.token_pair.to_account_info(),
                mint_recipient: ctx.accounts.cctp.mint_recipient.to_account_info(),
                custody_token: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_custody_token
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                token_messenger_minter_event_authority: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_event_authority
                    .to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        ReceiveMessageArgs {
            encoded_message: args.encoded_cctp_message,
            attestation: args.cctp_attestation,
        },
    )?;

    // Wormhole CCTP deposit should be ours, so make sure this is a fill we recognize.
    let deposit = LiquidityLayerMessage::try_from(vaa.payload())
        .unwrap()
        .to_deposit_unchecked();

    // This is safe because we know the amount is within u64 range.
    let amount = u64::try_from(ruint::aliases::U256::from_be_bytes(deposit.amount())).unwrap();

    // This operation is safe because we already validated the fill from the account context.
    let fill = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .unwrap()
        .to_fill_unchecked();

    // Set prepared fill data.
    ctx.accounts.prepared_fill.set_inner(PreparedFill {
        seeds: PreparedFillSeeds {
            fill_source: ctx.accounts.fill_vaa.key(),
            bump: ctx.bumps.prepared_fill,
        },
        info: PreparedFillInfo {
            prepared_custody_token_bump: ctx.bumps.prepared_custody_token,
            redeemer: Pubkey::from(fill.redeemer()),
            prepared_by: ctx.accounts.payer.key(),
            fill_type: FillType::WormholeCctpDeposit,
            source_chain: fill.source_chain(),
            order_sender: fill.order_sender(),
            timestamp: vaa.timestamp().into(),
        },
        redeemer_message: fill.message_to_vec(),
    });

    // Finally transfer to prepared custody account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.cctp.mint_recipient.to_account_info(),
                to: ctx.accounts.prepared_custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount,
    )
}

fn try_compute_prepared_fill_size(fill_vaa: &LiquidityLayerVaa) -> Result<usize> {
    let vaa = fill_vaa.load_unchecked();
    let msg = LiquidityLayerMessage::try_from(vaa.payload()).unwrap();

    let deposit = msg
        .deposit()
        .ok_or(error!(TokenRouterError::InvalidPayloadId))?;
    let msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| TokenRouterError::InvalidDepositMessage)?;
    let fill = msg
        .fill()
        .ok_or(TokenRouterError::InvalidDepositPayloadId)?;

    Ok(PreparedFill::compute_size(
        fill.redeemer_message_len().into(),
    ))
}
