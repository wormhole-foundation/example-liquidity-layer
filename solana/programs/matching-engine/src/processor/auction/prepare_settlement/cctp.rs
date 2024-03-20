use crate::{
    error::MatchingEngineError,
    processor::shared_contexts::*,
    state::{Custodian, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::{LiquidityLayerDepositMessage, LiquidityLayerMessage},
    wormhole_cctp_solana::{self, cctp::message_transmitter_program, wormhole::VaaAccount},
};

#[derive(Accounts)]
pub struct PrepareOrderResponseCctp<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    fast_vaa: LiquidityLayerVaa<'info>,

    #[account(
        constraint = {
            // Fast and finalized VAAs must reconcile with each other.
            let fast_vaa = VaaAccount::load_unchecked(&fast_vaa);
            let finalized_vaa = VaaAccount::load_unchecked(&finalized_vaa);

            require_eq!(
                fast_vaa.emitter_chain(),
                finalized_vaa.emitter_chain(),
                MatchingEngineError::VaaMismatch
            );
            require!(
                fast_vaa.emitter_address() == finalized_vaa.emitter_address(),
                MatchingEngineError::VaaMismatch
            );
            require_eq!(
                fast_vaa.sequence(),
                finalized_vaa.sequence() + 1,
                MatchingEngineError::VaaMismatch
            );
            require!(
                fast_vaa.timestamp() == finalized_vaa.timestamp(),
                MatchingEngineError::VaaMismatch
            );

            // Make sure the finalized VAA is a slow order response encoded in a deposit.
            let finalized_msg = LiquidityLayerMessage::try_from(finalized_vaa.payload()).unwrap();
            let deposit = finalized_msg
                .deposit()
                .ok_or(MatchingEngineError::InvalidPayloadId)?;
            let deposit_msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
                .map_err(|_| error!(MatchingEngineError::InvalidDepositMessage))?;
            let slow_order_response = deposit_msg
                .slow_order_response()
                .ok_or(MatchingEngineError::InvalidDepositPayloadId)?;

            true
        }
    )]
    finalized_vaa: LiquidityLayerVaa<'info>,

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

    cctp: CctpReceiveMessage<'info>,

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
    let finalized_vaa = wormhole_cctp_solana::cpi::verify_vaa_and_mint(
        &ctx.accounts.finalized_vaa,
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
        wormhole_cctp_solana::cpi::ReceiveMessageArgs {
            encoded_message: args.encoded_cctp_message,
            attestation: args.cctp_attestation,
        },
    )?;

    // This should be infallible because:
    // 1. We know that the fast VAA was used to start this auction (using its hash for the
    //    auction data PDA).
    // 2. The finalized VAA's sequence is one greater than the fast VAA's sequence.
    //
    // However, we will still process results in case Token Router implementation renders any of
    // these assumptions invalid.
    let finalized_msg = LiquidityLayerMessage::try_from(finalized_vaa.payload()).unwrap();
    let deposit = finalized_msg.to_deposit_unchecked();
    let base_fee = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .unwrap()
        .to_slow_order_response_unchecked()
        .base_fee();

    let fast_vaa_hash = VaaAccount::load_unchecked(&ctx.accounts.fast_vaa)
        .digest()
        .0;

    // Write to the prepared slow order account, which will be closed by one of the following
    // instructions:
    // * settle_auction_active_cctp
    // * settle_auction_complete
    // * settle_auction_none
    ctx.accounts
        .prepared_order_response
        .set_inner(PreparedOrderResponse {
            bump: ctx.bumps.prepared_order_response,
            fast_vaa_hash,
            prepared_by: ctx.accounts.payer.key(),
            source_chain: finalized_vaa.emitter_chain(),
            base_fee,
        });

    // Done.
    Ok(())
}
