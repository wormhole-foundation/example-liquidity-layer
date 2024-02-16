use crate::{
    error::TokenRouterError,
    state::{Custodian, FillType, PreparedFill, PreparedFillInfo},
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token;
use common::{
    messages::raw::{LiquidityLayerDepositMessage, LiquidityLayerMessage, MessageToVec},
    wormhole_cctp_solana::{
        self,
        cctp::{message_transmitter_program, token_messenger_minter_program},
        cpi::ReceiveMessageArgs,
        utils::WormholeCctpPayload,
        wormhole::VaaAccount,
    },
};

/// Accounts required for [redeem_cctp_fill].
#[derive(Accounts)]
pub struct RedeemCctpFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// Custodian, but does not need to be deserialized.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: AccountInfo<'info>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. Ownership check happens in
    /// [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint).
    vaa: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = compute_prepared_fill_size(&vaa)?,
        seeds = [
            PreparedFill::SEED_PREFIX,
            VaaAccount::load(&vaa)?.digest().as_ref(),
        ],
        bump,
    )]
    prepared_fill: Box<Account<'info, PreparedFill>>,

    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id() @ TokenRouterError::InvalidCustodyToken,
    )]
    cctp_mint_recipient: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        init_if_needed,
        payer = payer,
        token::mint = mint,
        token::authority = custodian,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_fill.key().as_ref(),
        ],
        bump,
    )]
    prepared_custody_token: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: This mint must be USDC.
    #[account(address = common::constants::USDC_MINT)]
    mint: AccountInfo<'info>,

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

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program)).
    token_messenger_minter_event_authority: UncheckedAccount<'info>,

    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
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
        &ctx.accounts.vaa,
        CpiContext::new_with_signer(
            ctx.accounts.message_transmitter_program.to_account_info(),
            message_transmitter_program::cpi::ReceiveTokenMessengerMinterMessage {
                payer: ctx.accounts.payer.to_account_info(),
                caller: ctx.accounts.custodian.to_account_info(),
                message_transmitter_authority: ctx
                    .accounts
                    .message_transmitter_authority
                    .to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .message_transmitter_config
                    .to_account_info(),
                used_nonces: ctx.accounts.used_nonces.to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                message_transmitter_event_authority: ctx
                    .accounts
                    .message_transmitter_event_authority
                    .to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger: ctx.accounts.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.token_minter.to_account_info(),
                local_token: ctx.accounts.local_token.to_account_info(),
                token_pair: ctx.accounts.token_pair.to_account_info(),
                mint_recipient: ctx.accounts.cctp_mint_recipient.to_account_info(),
                custody_token: ctx
                    .accounts
                    .token_messenger_minter_custody_token
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                token_messenger_minter_event_authority: ctx
                    .accounts
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
        let acc_info: &AccountInfo = ctx.accounts.prepared_fill.as_ref().as_ref();
        let lamport_diff = Rent::get().map(|rent| {
            rent.minimum_balance(data_len)
                .saturating_sub(acc_info.lamports())
        })?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.prepared_fill.to_account_info(),
                },
            ),
            lamport_diff,
        )?;
        acc_info.realloc(data_len, false)?;
    }

    // Set prepared fill data.
    ctx.accounts.prepared_fill.set_inner(PreparedFill {
        info: PreparedFillInfo {
            vaa_hash: vaa.digest().0,
            bump: ctx.bumps.prepared_fill,
            prepared_custody_token_bump: ctx.bumps.prepared_custody_token,
            redeemer: Pubkey::from(fill.redeemer()),
            prepared_by: ctx.accounts.payer.key(),
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
                to: ctx.accounts.prepared_custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount,
    )?;

    // TODO: close custody token.
    Ok(())
}

fn compute_prepared_fill_size(vaa_acc_info: &AccountInfo<'_>) -> Result<usize> {
    let vaa = VaaAccount::load(vaa_acc_info)?;
    let msg =
        LiquidityLayerMessage::try_from(vaa.payload()).map_err(|_| TokenRouterError::InvalidVaa)?;

    let deposit = msg.deposit().ok_or(TokenRouterError::InvalidPayloadId)?;
    let msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| TokenRouterError::InvalidDepositMessage)?;
    let fill = msg.fill().ok_or(TokenRouterError::InvalidPayloadId)?;
    Ok(fill
        .redeemer_message_len()
        .try_into()
        .map(PreparedFill::compute_size)
        .unwrap())
}
