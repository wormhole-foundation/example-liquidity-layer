mod cctp;
pub use cctp::*;

mod local;
pub use local::*;
use solana_program::program::invoke_signed_unchecked;

use crate::{
    composite::*,
    error::MatchingEngineError,
    events::OrderExecuted,
    state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus, MessageProtocol},
    utils::{self, auction::DepositPenalty},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, spl_token, TokenAccount};
use common::messages::{
    raw::{LiquidityLayerMessage, MessageToVec},
    Fill,
};

struct PreparedOrderExecution {
    pub user_amount: u64,
    pub fill: Fill,
    pub order_executed_event: OrderExecuted,
}

fn handle_execute_fast_order<'info>(
    execute_order: &mut ExecuteOrder<'info>,
    custodian: &CheckedCustodian<'info>,
    token_program: &Program<'info, token::Token>,
) -> Result<PreparedOrderExecution> {
    let auction = &mut execute_order.active_auction.auction;
    let fast_vaa = &execute_order.fast_vaa;
    let custody_token = &execute_order.active_auction.custody_token;
    let config = &execute_order.active_auction.config;
    let executor_token = &execute_order.executor_token;
    let best_offer_token = &execute_order.active_auction.best_offer_token;
    let initial_offer_token = &execute_order.initial_offer_token;

    let vaa = fast_vaa.load_unchecked();
    let order = LiquidityLayerMessage::try_from(vaa.payload())
        .unwrap()
        .to_fast_market_order_unchecked();

    let active_auction_account_infos = ActiveAuctionAccountInfos {
        auction_best_offer_token: execute_order
            .active_auction
            .best_offer_token
            .to_account_info(),
        auction_executor_token: execute_order.executor_token.to_account_info(),
        auction_initial_offer_token: execute_order.initial_offer_token.to_account_info(),
        auction_custody_token: execute_order.active_auction.custody_token.to_account_info(),
        active_auction: auction.to_account_info(),
        auction_custodian: custodian.to_account_info(),
    };

    let accounts = &[
        auction.to_account_info(),
        custody_token.to_account_info(),
        config.to_account_info(),
        executor_token.to_account_info(),
        best_offer_token.to_account_info(),
        initial_offer_token.to_account_info(),
        fast_vaa.to_account_info(),
        token_program.to_account_info(),
    ];

    let (user_amount, new_status, penalized) = get_user_amount_and_new_status_and_penalized(
        auction,
        custody_token,
        config,
        order.init_auction_fee(),
        active_auction_account_infos,
        accounts,
    )?;

    let order_executed_event =
        get_order_executed_event(auction, fast_vaa, auction.info.as_ref().unwrap(), penalized);

    // Set the auction status to completed.
    auction.status = new_status;

    Ok(PreparedOrderExecution {
        user_amount,
        fill: Fill {
            source_chain: vaa.emitter_chain(),
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: order
                .message_to_vec()
                .try_into()
                .map_err(|_| MatchingEngineError::RedeemerMessageTooLarge)?,
        },
        order_executed_event,
    })
}

pub struct ActiveAuctionAccountInfos<'ix> {
    pub auction_best_offer_token: AccountInfo<'ix>,
    pub auction_executor_token: AccountInfo<'ix>,
    pub auction_initial_offer_token: AccountInfo<'ix>,
    pub auction_custody_token: AccountInfo<'ix>,
    pub active_auction: AccountInfo<'ix>,
    pub auction_custodian: AccountInfo<'ix>,
}

pub fn get_user_amount_and_new_status_and_penalized(
    auction: &Auction,
    custody_token: &TokenAccount,
    auction_config: &AuctionConfig,
    init_auction_fee: u64,
    active_auction_account_infos: ActiveAuctionAccountInfos<'_>,
    accounts: &[AccountInfo],
) -> Result<(u64, AuctionStatus, bool)> {
    let auction_info = auction.info.as_ref().unwrap();
    let current_slot = Clock::get().unwrap().slot;

    let ActiveAuctionAccountInfos {
        auction_best_offer_token: active_auction_best_offer_token,
        auction_executor_token: active_auction_executor_token,
        auction_initial_offer_token: active_auction_initial_offer_token,
        auction_custody_token: active_auction_custody_token,
        active_auction,
        auction_custodian: active_auction_custodian,
    } = active_auction_account_infos;

    let additional_grace_period = match auction.target_protocol {
        MessageProtocol::Local { .. } => {
            crate::EXECUTE_FAST_ORDER_LOCAL_ADDITIONAL_GRACE_PERIOD.into()
        }
        _ => None,
    };

    let DepositPenalty {
        penalty,
        user_reward,
    } = utils::auction::compute_deposit_penalty(
        &auction_config.parameters,
        auction_info,
        current_slot,
        additional_grace_period,
    );

    let user_amount = auction_info
        .amount_in
        .saturating_sub(auction_info.offer_price)
        .saturating_sub(init_auction_fee)
        .saturating_add(user_reward);
    let mut remaining_custodied_amount = custody_token.amount.saturating_sub(user_amount);

    let mut deposit_and_fee = auction_info
        .offer_price
        .saturating_add(auction_info.security_deposit)
        .saturating_sub(user_reward);

    let auction_signer_seeds = &[
        Auction::SEED_PREFIX,
        auction.vaa_hash.as_ref(),
        &[auction.bump],
    ];

    let penalized = penalty > 0;

    if penalized && active_auction_best_offer_token.key() != active_auction_executor_token.key() {
        deposit_and_fee = deposit_and_fee.saturating_sub(penalty);
    }

    if utils::checked_deserialize_token_account(
        &active_auction_initial_offer_token,
        &common::USDC_MINT,
    )
    .is_some()
    {
        if active_auction_best_offer_token.key() != active_auction_initial_offer_token.key() {
            // Pay the auction initiator their fee.
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                &active_auction_custody_token.key(),
                &active_auction_initial_offer_token.key(),
                &active_auction.key(),
                &[],
                init_auction_fee,
            )
            .unwrap();

            invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
            // Because the initial offer token was paid this fee, we account for it here.
            remaining_custodied_amount =
                remaining_custodied_amount.saturating_sub(init_auction_fee);
        } else {
            // Add it to the reimbursement.
            deposit_and_fee = deposit_and_fee
                .checked_add(init_auction_fee)
                .ok_or_else(|| MatchingEngineError::U64Overflow)?;
        }
    }

    // Return the security deposit and the fee to the highest bidder.
    if active_auction_best_offer_token.key() == active_auction_executor_token.key() {
        // If the best offer token is equal to the executor token, just send whatever remains in
        // the custody token account.
        //
        // NOTE: This will revert if the best offer token does not exist. But this will present
        // an opportunity for another executor to execute this order and take what the best
        // offer token would have received.
        let transfer_ix = spl_token::instruction::transfer(
            &spl_token::ID,
            &active_auction_custody_token.key(),
            &active_auction_best_offer_token.key(),
            &active_auction.key(),
            &[],
            deposit_and_fee,
        )
        .unwrap();
        msg!(
            "Sending deposit and fee amount {} to best offer token account",
            deposit_and_fee
        );
        invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
    } else {
        // Otherwise, send the deposit and fee to the best offer token. If the best offer token
        // doesn't exist at this point (which would be unusual), we will reserve these funds
        // for the executor token.
        if utils::checked_deserialize_token_account(
            &active_auction_best_offer_token,
            &common::USDC_MINT,
        )
        .is_some()
        {
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                &active_auction_custody_token.key(),
                &active_auction_best_offer_token.key(),
                &active_auction.key(),
                &[],
                deposit_and_fee,
            )
            .unwrap();
            msg!(
                "Sending deposit and fee {} to best offer token account",
                deposit_and_fee
            );
            invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
            remaining_custodied_amount = remaining_custodied_amount.saturating_sub(deposit_and_fee);
        }

        // And pay the executor whatever remains in the auction custody token account.
        if remaining_custodied_amount > 0 {
            let instruction = spl_token::instruction::transfer(
                &spl_token::ID,
                &active_auction_custody_token.key(),
                &active_auction_executor_token.key(),
                &active_auction.key(),
                &[],
                remaining_custodied_amount,
            )
            .unwrap();
            msg!(
                "Sending remaining custodied amount {} to executor token account",
                remaining_custodied_amount
            );
            invoke_signed_unchecked(&instruction, accounts, &[auction_signer_seeds])?;
        }
    }

    // Set the authority of the custody token account to the custodian. He will take over from
    // here.
    let set_authority_ix = spl_token::instruction::set_authority(
        &spl_token::ID,
        &active_auction_custody_token.key(),
        Some(&active_auction_custodian.key()),
        spl_token::instruction::AuthorityType::AccountOwner,
        &active_auction.key(),
        &[],
    )
    .unwrap();

    invoke_signed_unchecked(&set_authority_ix, accounts, &[auction_signer_seeds])?;

    Ok((
        user_amount,
        AuctionStatus::Completed {
            slot: current_slot,
            execute_penalty: if penalized { penalty.into() } else { None },
        },
        penalized,
    ))
}

pub fn get_order_executed_event(
    auction: &Auction,
    fast_vaa: &AccountInfo<'_>,
    auction_info: &AuctionInfo,
    penalized: bool,
) -> OrderExecuted {
    OrderExecuted {
        fast_vaa_hash: auction.vaa_hash,
        vaa: fast_vaa.key(),
        source_chain: auction_info.source_chain,
        target_protocol: auction.target_protocol,
        penalized,
    }
}
