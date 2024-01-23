mod execute_fast_order;
pub use execute_fast_order::*;

mod offer;
pub use offer::*;

mod prepare_settlement;
pub use prepare_settlement::*;

mod settle;
pub use settle::*;

use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::{
    error::MatchingEngineError,
    state::{AuctionData, AuctionStatus, Custodian, PayerSequence, RouterEndpoint},
};
use common::messages::raw::LiquidityLayerPayload;
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program,
};

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

pub struct ExecuteFastOrderAccounts<'ctx, 'info> {
    custodian: &'ctx Account<'info, Custodian>,
    vaa: &'ctx AccountInfo<'info>,
    auction_data: &'ctx mut Box<Account<'info, AuctionData>>,
    custody_token: &'ctx AccountInfo<'info>,
    executor_token: &'ctx Account<'info, token::TokenAccount>,
    best_offer_token: &'ctx AccountInfo<'info>,
    initial_offer_token: &'ctx AccountInfo<'info>,
    token_program: &'ctx Program<'info, token::Token>,
}

pub struct ReturnArgs {
    pub transfer_amount: u64,
    pub cctp_destination_domain: u32,
    pub fill: common::messages::Fill,
}

pub fn handle_fast_order_execution(accounts: ExecuteFastOrderAccounts) -> Result<ReturnArgs> {
    let slots_elapsed = Clock::get()?.slot - accounts.auction_data.start_slot;
    let auction_config = &accounts.custodian.auction_config;
    require!(
        slots_elapsed > auction_config.auction_duration.into(),
        MatchingEngineError::AuctionPeriodNotExpired
    );

    // Create zero copy reference to `FastMarketOrder` payload.
    let vaa = VaaAccount::load(accounts.vaa)?;
    let msg = LiquidityLayerPayload::try_from(vaa.try_payload()?)
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;
    let auction_data = accounts.auction_data;

    // Save the custodian seeds to sign transfers with.
    let custodian_seeds = &[Custodian::SEED_PREFIX, &[accounts.custodian.bump]];

    // We need to save the reward for the user so we include it when sending the CCTP transfer.
    let mut user_reward: u64 = 0;

    if slots_elapsed > auction_config.auction_grace_period.into() {
        let (penalty, reward) = crate::utils::calculate_dynamic_penalty(
            &accounts.custodian.auction_config,
            auction_data.security_deposit,
            slots_elapsed,
        )
        .ok_or(MatchingEngineError::PenaltyCalculationFailed)?;

        // Save user reward for CCTP transfer.
        user_reward = reward;

        // If caller passes in the same token account, only perform one transfer.
        if accounts.best_offer_token.key() == accounts.executor_token.key() {
            token::transfer(
                CpiContext::new_with_signer(
                    accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: accounts.custody_token.to_account_info(),
                        to: accounts.best_offer_token.to_account_info(),
                        authority: accounts.custodian.to_account_info(),
                    },
                    &[custodian_seeds],
                ),
                auction_data
                    .offer_price
                    .checked_add(auction_data.security_deposit)
                    .unwrap()
                    .checked_sub(reward)
                    .unwrap(),
            )?;
        } else {
            // Pay the liquidator the penalty.
            if penalty > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        accounts.token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: accounts.custody_token.to_account_info(),
                            to: accounts.executor_token.to_account_info(),
                            authority: accounts.custodian.to_account_info(),
                        },
                        &[custodian_seeds],
                    ),
                    penalty,
                )?;
            }

            token::transfer(
                CpiContext::new_with_signer(
                    accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: accounts.custody_token.to_account_info(),
                        to: accounts.best_offer_token.to_account_info(),
                        authority: accounts.custodian.to_account_info(),
                    },
                    &[custodian_seeds],
                ),
                auction_data
                    .offer_price
                    .checked_add(auction_data.security_deposit)
                    .unwrap()
                    .checked_sub(reward)
                    .unwrap()
                    .checked_sub(penalty)
                    .unwrap(),
            )?;
        }
    } else {
        // Return the security deposit and the fee to the highest bidder.
        token::transfer(
            CpiContext::new_with_signer(
                accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: accounts.custody_token.to_account_info(),
                    to: accounts.best_offer_token.to_account_info(),
                    authority: accounts.custodian.to_account_info(),
                },
                &[custodian_seeds],
            ),
            auction_data
                .offer_price
                .checked_add(auction_data.security_deposit)
                .unwrap(),
        )?;
    }

    // Pay the auction initiator their fee.
    token::transfer(
        CpiContext::new_with_signer(
            accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: accounts.custody_token.to_account_info(),
                to: accounts.initial_offer_token.to_account_info(),
                authority: accounts.custodian.to_account_info(),
            },
            &[&custodian_seeds[..]],
        ),
        fast_order.init_auction_fee(),
    )?;

    // Set the auction status to completed.
    auction_data.status = AuctionStatus::Completed;

    Ok(ReturnArgs {
        transfer_amount: auction_data
            .amount
            .checked_sub(auction_data.offer_price)
            .unwrap()
            .checked_sub(fast_order.init_auction_fee())
            .unwrap()
            .checked_add(user_reward)
            .unwrap(),
        cctp_destination_domain: fast_order.destination_cctp_domain(),
        fill: common::messages::Fill {
            source_chain: vaa.try_emitter_chain()?,
            order_sender: fast_order.sender(),
            redeemer: fast_order.redeemer(),
            redeemer_message: <&[u8]>::from(fast_order.redeemer_message()).to_vec().into(),
        },
    })
}

pub fn send_cctp(
    accounts: CctpAccounts,
    amount: u64,
    destination_cctp_domain: u32,
    payload: Vec<u8>,
    core_message_bump: u8,
) -> Result<()> {
    let authority_seeds = &[Custodian::SEED_PREFIX, &[accounts.custodian.bump]];

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
            burn_source: None,
            destination_caller: accounts.to_router_endpoint.address,
            destination_cctp_domain,
            amount,
            mint_recipient: accounts.to_router_endpoint.address,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload,
        },
    )?;

    Ok(())
}
