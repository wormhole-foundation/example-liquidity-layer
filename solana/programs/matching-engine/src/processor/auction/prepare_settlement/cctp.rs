use crate::{
    error::MatchingEngineError,
    state::{Custodian, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::{LiquidityLayerDepositMessage, LiquidityLayerMessage},
    wormhole_cctp_solana::{
        self,
        cctp::{message_transmitter_program, token_messenger_minter_program},
        wormhole::{core_bridge_program, VaaAccount},
    },
};

#[derive(Accounts)]
pub struct PrepareOrderResponseCctp<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Box<Account<'info, Custodian>>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    fast_vaa: AccountInfo<'info>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. Ownership check happens in
    /// [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint).
    finalized_vaa: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PreparedOrderResponse::INIT_SPACE,
        seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            payer.key().as_ref(),
            VaaAccount::load(&fast_vaa)?.digest().as_ref()
        ],
        bump,
    )]
    prepared_order_response: Account<'info, PreparedOrderResponse>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id() @ MatchingEngineError::InvalidCustodyToken,
    )]
    cctp_mint_recipient: AccountInfo<'info>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    message_transmitter_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    used_nonces: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Message Transmitter program)).
    message_transmitter_event_authority: AccountInfo<'info>,

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
    token_messenger_minter_event_authority: AccountInfo<'info>,

    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CctpMessageArgs {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
}

pub fn prepare_order_response_cctp(
    ctx: Context<PrepareOrderResponseCctp>,
    args: CctpMessageArgs,
) -> Result<()> {
    let fast_vaa = VaaAccount::load_unchecked(&ctx.accounts.fast_vaa);

    let finalized_vaa = wormhole_cctp_solana::cpi::verify_vaa_and_mint(
        &ctx.accounts.finalized_vaa,
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
        wormhole_cctp_solana::cpi::ReceiveMessageArgs {
            encoded_message: args.encoded_cctp_message,
            attestation: args.cctp_attestation,
        },
    )?;

    // Reconcile fast VAA with finalized VAA.
    let source_chain = {
        let fast_emitter = fast_vaa.emitter_info();
        let finalized_emitter = finalized_vaa.emitter_info();
        require_eq!(
            fast_emitter.chain,
            finalized_emitter.chain,
            MatchingEngineError::VaaMismatch
        );
        require!(
            fast_emitter.address == finalized_emitter.address,
            MatchingEngineError::VaaMismatch
        );
        require_eq!(
            fast_emitter.sequence,
            finalized_emitter.sequence + 1,
            MatchingEngineError::VaaMismatch
        );
        require!(
            fast_vaa.timestamp() == finalized_vaa.timestamp(),
            MatchingEngineError::VaaMismatch
        );

        finalized_emitter.chain
    };

    // This should be infallible because:
    // 1. We know that the fast VAA was used to start this auction (using its hash for the
    //    auction data PDA).
    // 2. The finalized VAA's sequence is one greater than the fast VAA's sequence.
    //
    // However, we will still process results in case Token Router implementation renders any of
    // these assumptions invalid.
    let finalized_msg = LiquidityLayerMessage::try_from(finalized_vaa.payload())
        .map_err(|_| error!(MatchingEngineError::InvalidVaa))?;
    let deposit = finalized_msg
        .deposit()
        .ok_or(MatchingEngineError::InvalidPayloadId)?;
    let deposit_msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| error!(MatchingEngineError::InvalidDepositMessage))?;
    let slow_order_response = deposit_msg
        .slow_order_response()
        .ok_or(MatchingEngineError::InvalidDepositPayloadId)?;

    // Write to the prepared slow order account, which will be closed by one of the following
    // instructions:
    // * settle_auction_active_cctp
    // * settle_auction_complete
    // * settle_auction_none
    ctx.accounts
        .prepared_order_response
        .set_inner(PreparedOrderResponse {
            bump: ctx.bumps.prepared_order_response,
            fast_vaa_hash: fast_vaa.digest().0,
            prepared_by: ctx.accounts.payer.key(),
            source_chain,
            base_fee: slow_order_response.base_fee(),
        });

    // Done.
    Ok(())
}
