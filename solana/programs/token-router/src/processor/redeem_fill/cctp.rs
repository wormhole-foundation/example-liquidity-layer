use crate::{
    error::TokenRouterError,
    state::{Custodian, RouterEndpoint},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerDepositMessage;
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    cpi::ReceiveMessageArgs,
    utils::WormholeCctpPayload,
    wormhole::core_bridge_program,
};

/// Account context to invoke [redeem_cctp_fill].
#[derive(Accounts)]
pub struct RedeemCctpFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

    /// Redeemer, who owns the token account that will receive the minted tokens.
    ///
    /// CHECK: Signer must be the redeemer encoded in the Deposit Fill message.
    redeemer: Signer<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    dst_token: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    /// Registered emitter account representing a Circle Integration on another network.
    ///
    /// Seeds must be \["registered_emitter", target_chain.to_be_bytes()\].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = router_endpoint.bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    message_transmitter_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    used_nonces: UncheckedAccount<'info>,

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

    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// This instruction reconciles a Wormhole CCTP deposit message with a CCTP message to mint tokens
/// for the [mint_recipient](RedeemCctpFill::mint_recipient) token account.
///
/// See [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint) for more details.
pub fn redeem_cctp_fill(ctx: Context<RedeemCctpFill>, args: super::RedeemFillArgs) -> Result<()> {
    let custodian_seeds = &[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]];

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
                token_messenger: ctx.accounts.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.token_minter.to_account_info(),
                local_token: ctx.accounts.local_token.to_account_info(),
                token_pair: ctx.accounts.token_pair.to_account_info(),
                mint_recipient: ctx.accounts.custody_token.to_account_info(),
                custody_token: ctx
                    .accounts
                    .token_messenger_minter_custody_token
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            &[custodian_seeds],
        ),
        ReceiveMessageArgs {
            encoded_message: args.encoded_cctp_message,
            attestation: args.cctp_attestation,
        },
    )?;

    // Validate that this message originated from a registered emitter.
    let endpoint = &ctx.accounts.router_endpoint;
    let emitter = vaa.try_emitter_info().unwrap();
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
    let deposit = WormholeCctpPayload::try_from(vaa.try_payload().unwrap())
        .unwrap()
        .message()
        .to_deposit_unchecked();

    // Save for final transfer.
    //
    // NOTE: This is safe because we know the amount is within u64 range.
    let amount = u64::try_from(ruint::aliases::U256::from_be_bytes(deposit.amount())).unwrap();

    // Verify as Liquiditiy Layer Deposit message.
    let msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| TokenRouterError::InvalidDepositMessage)?;

    // Verify redeemer.
    let fill = msg.fill().ok_or(TokenRouterError::InvalidPayloadId)?;
    require_keys_eq!(
        Pubkey::from(fill.redeemer()),
        ctx.accounts.redeemer.key(),
        TokenRouterError::InvalidRedeemer
    );

    // Finally transfer tokens to destination.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.dst_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[custodian_seeds],
        ),
        amount,
    )
}
