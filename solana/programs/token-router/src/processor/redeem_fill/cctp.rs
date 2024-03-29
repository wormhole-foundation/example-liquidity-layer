use crate::{
    composite::*,
    error::TokenRouterError,
    state::{Custodian, FillType, PreparedFill, PreparedFillInfo},
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token;
use common::{
    messages::raw::{LiquidityLayerDepositMessage, MessageToVec},
    wormhole_cctp_solana::{
        self,
        cctp::{message_transmitter_program, token_messenger_minter_program},
        cpi::ReceiveMessageArgs,
        utils::WormholeCctpPayload,
    },
};

#[derive(Accounts)]
struct CctpReceiveMessage<'info> {
    mint_recipient: CctpMintRecipientMut<'info>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    message_transmitter_authority: AccountInfo<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    message_transmitter_config: AccountInfo<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    used_nonces: AccountInfo<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Message Transmitter program)).
    message_transmitter_event_authority: AccountInfo<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    token_messenger: AccountInfo<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    remote_token_messenger: AccountInfo<'info>,

    /// CHECK: Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    token_minter: AccountInfo<'info>,

    /// Token Messenger Minter's Local Token account. This program uses the mint of this account to
    /// validate the `mint_recipient` token account's mint.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    local_token: AccountInfo<'info>,

    /// CHECK: Seeds must be \["token_pair", remote_domain.to_string(), remote_token_address\] (CCTP
    /// Token Messenger Minter program).
    token_pair: AccountInfo<'info>,

    /// CHECK: Mutable. Seeds must be \["custody", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    token_messenger_minter_custody_token: AccountInfo<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program).
    token_messenger_minter_event_authority: AccountInfo<'info>,

    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
}

/// Accounts required for [redeem_cctp_fill].
#[derive(Accounts)]
pub struct RedeemCctpFill<'info> {
    custodian: CheckedCustodian<'info>,

    prepared_fill: InitIfNeededPreparedFill<'info>,

    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id() @ TokenRouterError::InvalidCustodyToken,
    )]
    cctp_mint_recipient: AccountInfo<'info>,

    /// Registered emitter account representing a Circle Integration on another network.
    ///
    /// Seeds must be \["registered_emitter", target_chain.to_be_bytes()\].
    #[account(
        seeds = [
            matching_engine::state::RouterEndpoint::SEED_PREFIX,
            router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = router_endpoint.bump,
        seeds::program = matching_engine::id(),
    )]
    router_endpoint: Box<Account<'info, matching_engine::state::RouterEndpoint>>,

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
        &ctx.accounts.prepared_fill.fill_vaa,
        CpiContext::new_with_signer(
            ctx.accounts
                .cctp
                .message_transmitter_program
                .to_account_info(),
            message_transmitter_program::cpi::ReceiveTokenMessengerMinterMessage {
                payer: ctx.accounts.prepared_fill.payer.to_account_info(),
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

    // Validate that this message originated from a registered emitter.
    let endpoint = &ctx.accounts.router_endpoint;
    let emitter = vaa.emitter_info();
    require_eq!(
        emitter.chain,
        endpoint.chain,
        TokenRouterError::InvalidSourceRouter
    );
    require!(
        emitter.address == endpoint.address,
        TokenRouterError::InvalidSourceRouter
    );

    // Wormhole CCTP deposit should be ours, so make sure this is a fill we recognize.
    let deposit = WormholeCctpPayload::try_from(vaa.payload())
        .unwrap()
        .message()
        .to_deposit_unchecked();

    // NOTE: This is safe because we know the amount is within u64 range.
    let amount = u64::try_from(ruint::aliases::U256::from_be_bytes(deposit.amount())).unwrap();

    // Verify as Liquiditiy Layer Deposit message.
    let fill = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .unwrap()
        .to_fill_unchecked();

    {
        let data_len = PreparedFill::compute_size(fill.redeemer_message_len().try_into().unwrap());
        let acc_info: &AccountInfo = ctx.accounts.prepared_fill.as_ref();
        let lamport_diff = Rent::get().map(|rent| {
            rent.minimum_balance(data_len)
                .saturating_sub(acc_info.lamports())
        })?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.prepared_fill.payer.to_account_info(),
                    to: ctx.accounts.prepared_fill.to_account_info(),
                },
            ),
            lamport_diff,
        )?;
        acc_info.realloc(data_len, false)?;
    }

    // Set prepared fill data.
    ctx.accounts
        .prepared_fill
        .prepared_fill
        .set_inner(PreparedFill {
            info: PreparedFillInfo {
                vaa_hash: vaa.digest().0,
                bump: ctx.bumps.prepared_fill.prepared_fill,
                prepared_custody_token_bump: ctx.bumps.prepared_fill.custody_token,
                redeemer: Pubkey::from(fill.redeemer()),
                prepared_by: ctx.accounts.prepared_fill.payer.key(),
                fill_type: FillType::WormholeCctpDeposit,
                source_chain: fill.source_chain(),
                order_sender: fill.order_sender(),
            },
            redeemer_message: fill.message_to_vec(),
        });

    // Transfer to prepared custody account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.cctp_mint_recipient.to_account_info(),
                to: ctx.accounts.prepared_fill.custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount,
    )?;

    // TODO: close custody token.
    Ok(())
}
