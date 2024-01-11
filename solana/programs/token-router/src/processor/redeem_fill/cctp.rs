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

/// Account context to invoke [redeem_fill_cctp].
#[derive(Accounts)]
pub struct RedeemFillCctp<'info> {
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

    /// Account representing that a VAA has been consumed.
    ///
    /// CHECK: Seeds must be [emitter_address, emitter_chain, sequence]. These seeds are checked
    /// when [claim_vaa](core_bridge_program::sdk::claim_vaa) is called.
    #[account(mut)]
    claim: AccountInfo<'info>,

    /// Redeemer, who owns the token account that will receive the minted tokens.
    ///
    /// CHECK: Signer who must be the owner of the `mint_recipient` token account.
    redeemer: Signer<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// NOTE: This account must be owned by the `mint_recipient_authority`.
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
    message_transmitter_config: AccountInfo<'info>,

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
    token_pair: AccountInfo<'info>,

    /// CHECK: Mutable. Seeds must be \["custody", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    token_messenger_minter_custody_token: AccountInfo<'info>,

    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// Arguments used to invoke [redeem_fill_cctp].
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RedeemFillCctpArgs {
    /// CCTP message.
    pub encoded_cctp_message: Vec<u8>,

    /// Attestation of [encoded_cctp_message](Self::encoded_cctp_message).
    pub cctp_attestation: Vec<u8>,
}

/// This instruction reconciles a Wormhole CCTP deposit message with a CCTP message to mint tokens
/// for the [mint_recipient](RedeemFillCctp::mint_recipient) token account.
///
/// See [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint) for more details.
pub fn redeem_fill_cctp(ctx: Context<RedeemFillCctp>, args: RedeemFillCctpArgs) -> Result<()> {
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
            &[&[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]]],
        ),
        ReceiveMessageArgs {
            encoded_message: args.encoded_cctp_message,
            attestation: args.cctp_attestation,
        },
    )?;

    // Validate that this message originated from a registered emitter.
    let endpoint = &ctx.accounts.router_endpoint;
    let emitter = vaa.try_emitter_info().unwrap();
    require!(
        emitter.chain == endpoint.chain && emitter.address == endpoint.address,
        TokenRouterError::InvalidSourceRouter
    );

    let deposit = WormholeCctpPayload::try_from(vaa.try_payload().unwrap())
        .unwrap()
        .message()
        .to_deposit_unchecked();
    let msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| TokenRouterError::InvalidDepositMessage)?;

    // Verify redeemer.
    let fill = msg.fill().ok_or(TokenRouterError::InvalidPayloadId)?;
    require_keys_eq!(
        Pubkey::from(fill.redeemer()),
        ctx.accounts.redeemer.key(),
        TokenRouterError::InvalidRedeemer
    );

    Ok(())
}
