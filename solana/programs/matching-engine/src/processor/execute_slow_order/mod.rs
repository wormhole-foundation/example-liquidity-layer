mod auction_completed;
pub use auction_completed::*;

mod no_auction;
pub use no_auction::*;

use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use common::messages::raw::{FastMarketOrder, LiquidityLayerDepositMessage, LiquidityLayerMessage};
use wormhole_cctp_solana::{
    cctp::message_transmitter_program, wormhole::core_bridge_program::VaaAccount,
};

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CctpMessageArgs {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
}

pub(self) struct PrepareExecuteSlowOrder<'ctx, 'info> {
    payer: &'ctx Signer<'info>,
    custodian: &'ctx Account<'info, Custodian>,
    finalized_vaa: &'ctx AccountInfo<'info>,
    custody_token: &'ctx AccountInfo<'info>,
    message_transmitter_authority: &'ctx AccountInfo<'info>,
    message_transmitter_config: &'ctx AccountInfo<'info>,
    used_nonces: &'ctx AccountInfo<'info>,
    token_messenger: &'ctx AccountInfo<'info>,
    remote_token_messenger: &'ctx AccountInfo<'info>,
    token_minter: &'ctx AccountInfo<'info>,
    local_token: &'ctx AccountInfo<'info>,
    token_pair: &'ctx AccountInfo<'info>,
    token_messenger_minter_custody_token: &'ctx AccountInfo<'info>,
    message_transmitter_program: &'ctx AccountInfo<'info>,
    token_messenger_minter_program: &'ctx AccountInfo<'info>,
    token_program: &'ctx AccountInfo<'info>,
    system_program: &'ctx AccountInfo<'info>,
}

pub(self) fn prepare_execute_slow_order<'ix, 'accts, 'info>(
    fast_vaa: &'ix VaaAccount<'accts>,
    accounts: PrepareExecuteSlowOrder<'accts, 'info>,
    args: CctpMessageArgs,
) -> Result<(FastMarketOrder<'accts>, u128)>
where
    'ix: 'accts,
{
    let custodian_bump = accounts.custodian.bump;

    let finalized_vaa = wormhole_cctp_solana::cpi::verify_vaa_and_mint(
        &accounts.finalized_vaa,
        CpiContext::new_with_signer(
            accounts.message_transmitter_program.to_account_info(),
            message_transmitter_program::cpi::ReceiveTokenMessengerMinterMessage {
                payer: accounts.payer.to_account_info(),
                caller: accounts.custodian.to_account_info(),
                message_transmitter_authority: accounts
                    .message_transmitter_authority
                    .to_account_info(),
                message_transmitter_config: accounts.message_transmitter_config.to_account_info(),
                used_nonces: accounts.used_nonces.to_account_info(),
                token_messenger_minter_program: accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                system_program: accounts.system_program.to_account_info(),
                token_messenger: accounts.token_messenger.to_account_info(),
                remote_token_messenger: accounts.remote_token_messenger.to_account_info(),
                token_minter: accounts.token_minter.to_account_info(),
                local_token: accounts.local_token.to_account_info(),
                token_pair: accounts.token_pair.to_account_info(),
                mint_recipient: accounts.custody_token.to_account_info(),
                custody_token: accounts
                    .token_messenger_minter_custody_token
                    .to_account_info(),
                token_program: accounts.token_program.to_account_info(),
            },
            &[&[Custodian::SEED_PREFIX, &[custodian_bump]]],
        ),
        wormhole_cctp_solana::cpi::ReceiveMessageArgs {
            encoded_message: args.encoded_cctp_message,
            attestation: args.cctp_attestation,
        },
    )?;

    // Reconcile fast VAA with finalized VAA.
    {
        let fast_emitter = fast_vaa.try_emitter_info().unwrap();
        let finalized_emitter = finalized_vaa.try_emitter_info().unwrap();
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
            fast_emitter.sequence + 1,
            finalized_emitter.sequence,
            MatchingEngineError::VaaMismatch
        );
        require!(
            fast_vaa.try_timestamp().unwrap() == finalized_vaa.try_timestamp().unwrap(),
            MatchingEngineError::VaaMismatch
        );
    }

    // This should be infallible because:
    // 1. We know that the fast VAA was used to start this auction (using its hash for the
    //    auction data PDA).
    // 2. The finalized VAA's sequence is one greater than the fast VAA's sequence.
    //
    // However, we will still process results in case Token Router implementation renders any of
    // these assumptions invalid.
    let finalized_msg = LiquidityLayerMessage::try_from(finalized_vaa.try_payload().unwrap())
        .map_err(|_| error!(MatchingEngineError::InvalidVaa))?;
    let deposit = finalized_msg
        .deposit()
        .ok_or(MatchingEngineError::InvalidPayloadId)?;
    let deposit_msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| error!(MatchingEngineError::InvalidDepositMessage))?;
    let slow_order_response = deposit_msg
        .slow_order_response()
        .ok_or(MatchingEngineError::InvalidDepositPayloadId)?;

    Ok((
        LiquidityLayerMessage::try_from(fast_vaa.try_payload().unwrap())
            .unwrap()
            .to_fast_market_order_unchecked(),
        slow_order_response.base_fee(),
    ))
}
