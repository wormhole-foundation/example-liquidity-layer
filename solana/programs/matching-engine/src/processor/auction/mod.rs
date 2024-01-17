mod place_initial_offer;
pub use place_initial_offer::*;

mod improve_offer;
pub use improve_offer::*;

mod execute_fast_order;
pub use execute_fast_order::*;

use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::{
    error::MatchingEngineError,
    state::{Custodian, PayerSequence, RouterEndpoint},
};
use wormhole_cctp_solana::wormhole::core_bridge_program::sdk::EmitterInfo;
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program,
};

pub fn verify_router_path(
    from_router_endpoint: &RouterEndpoint,
    to_router_endpoint: &RouterEndpoint,
    emitter_info: &EmitterInfo,
    target_chain: u16,
) -> Result<()> {
    require!(
        from_router_endpoint.chain == emitter_info.chain
            && from_router_endpoint.address == emitter_info.address,
        MatchingEngineError::InvalidEndpoint
    );
    require!(
        to_router_endpoint.chain == target_chain && to_router_endpoint.address != [0u8; 32],
        MatchingEngineError::InvalidEndpoint
    );

    Ok(())
}

pub struct CctpAccounts<'ctx, 'info> {
    payer: &'ctx Signer<'info>,
    custodian: &'ctx Account<'info, Custodian>,
    to_router_endpoint: &'ctx Account<'info, RouterEndpoint>,
    custody_token: &'ctx AccountInfo<'info>,
    mint: &'ctx AccountInfo<'info>,
    payer_sequence: &'ctx mut Account<'info, PayerSequence>,
    core_bridge_config: &'ctx UncheckedAccount<'info>,
    core_message: &'ctx AccountInfo<'info>,
    core_emitter_sequence: &'ctx UncheckedAccount<'info>,
    core_fee_collector: &'ctx UncheckedAccount<'info>,
    token_messenger_minter_sender_authority: &'ctx UncheckedAccount<'info>,
    message_transmitter_config: &'ctx UncheckedAccount<'info>,
    token_messenger: &'ctx UncheckedAccount<'info>,
    remote_token_messenger: &'ctx UncheckedAccount<'info>,
    token_minter: &'ctx UncheckedAccount<'info>,
    local_token: &'ctx UncheckedAccount<'info>,
    core_bridge_program: &'ctx Program<'info, core_bridge_program::CoreBridge>,
    token_messenger_minter_program:
        &'ctx Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program:
        &'ctx Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: &'ctx Program<'info, token::Token>,
    system_program: &'ctx Program<'info, System>,
    clock: &'ctx AccountInfo<'info>,
    rent: &'ctx AccountInfo<'info>,
}

pub fn send_cctp(
    accounts: CctpAccounts,
    amount: u64,
    destination_cctp_domain: u32,
    payload: Vec<u8>,
    core_message_bump: u8,
) -> Result<()> {
    let authority_seeds = &[Custodian::SEED_PREFIX.as_ref(), &[accounts.custodian.bump]];

    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            accounts.token_messenger_minter_program.to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                src_token_owner: accounts.custodian.to_account_info(),
                token_messenger_minter_sender_authority: accounts
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                src_token: accounts.custody_token.to_account_info(),
                message_transmitter_config: accounts.message_transmitter_config.to_account_info(),
                token_messenger: accounts.token_messenger.to_account_info(),
                remote_token_messenger: accounts.remote_token_messenger.to_account_info(),
                token_minter: accounts.token_minter.to_account_info(),
                local_token: accounts.local_token.to_account_info(),
                mint: accounts.mint.to_account_info(),
                message_transmitter_program: accounts.message_transmitter_program.to_account_info(),
                token_messenger_minter_program: accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: accounts.token_program.to_account_info(),
            },
            &[authority_seeds],
        ),
        CpiContext::new_with_signer(
            accounts.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
                payer: accounts.payer.to_account_info(),
                message: accounts.core_message.to_account_info(),
                emitter: accounts.custodian.to_account_info(),
                config: accounts.core_bridge_config.to_account_info(),
                emitter_sequence: accounts.core_emitter_sequence.to_account_info(),
                fee_collector: accounts.core_fee_collector.to_account_info(),
                system_program: accounts.system_program.to_account_info(),
                clock: accounts.clock.to_account_info(),
                rent: accounts.rent.to_account_info(),
            },
            &[
                authority_seeds,
                &[
                    common::constants::CORE_MESSAGE_SEED_PREFIX,
                    accounts.payer.key().as_ref(),
                    accounts
                        .payer_sequence
                        .take_and_uptick()
                        .to_be_bytes()
                        .as_ref(),
                    &[core_message_bump],
                ],
            ],
        ),
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: accounts.custody_token.key(),
            destination_caller: accounts.to_router_endpoint.address,
            destination_cctp_domain: destination_cctp_domain,
            amount,
            mint_recipient: accounts.to_router_endpoint.address,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload,
        },
    )?;

    Ok(())
}
