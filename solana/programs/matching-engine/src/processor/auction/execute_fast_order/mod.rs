mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, MessageProtocol},
    utils::{self, auction::DepositPenalty},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::{
    raw::{LiquidityLayerMessage, MessageToVec},
    Fill,
};

struct PrepareFastExecution<'ctx, 'info> {
    execute_order: &'ctx mut ExecuteOrder<'info>,
    custodian: &'ctx CheckedCustodian<'info>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct PreparedOrderExecution<'info> {
    pub user_amount: u64,
    pub fill: Fill,
    pub beneficiary: Option<AccountInfo<'info>>,
}

fn prepare_order_execution<'info>(
    accounts: PrepareFastExecution<'_, 'info>,
) -> Result<PreparedOrderExecution<'info>> {
    let PrepareFastExecution {
        execute_order,
        custodian,
        token_program,
    } = accounts;

    let auction = &mut execute_order.active_auction.auction;
    let fast_vaa = &execute_order.fast_vaa;
    let custody_token = &execute_order.active_auction.custody_token;
    let config = &execute_order.active_auction.config;
    let executor_token = &execute_order.executor_token;
    let best_offer_token = &execute_order.active_auction.best_offer_token;
    let initial_offer_token = &execute_order.initial_offer_token;
    let initial_participant = &execute_order.initial_participant;

    let vaa = fast_vaa.load_unchecked();
    let order = LiquidityLayerMessage::try_from(vaa.payload())
        .unwrap()
        .to_fast_market_order_unchecked();

    let (user_amount, new_status, beneficiary) = {
        let auction_info = auction.info.as_ref().unwrap();
        let current_slot = Clock::get().unwrap().slot;

        // We extend the grace period for locally executed orders. Reserving a sequence number for
        // the fast fill will most likely require an additional transaction, so this buffer allows
        // the best offer participant to perform his duty without the risk of getting slashed by
        // another executor.
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
            config,
            auction_info,
            current_slot,
            additional_grace_period,
        );

        let init_auction_fee = order.init_auction_fee();

        let user_amount = auction_info
            .amount_in
            .saturating_sub(auction_info.offer_price)
            .saturating_sub(init_auction_fee)
            .saturating_add(user_reward);

        // Keep track of the remaining amount in the custody token account. Whatever remains will go
        // to the executor.
        let mut remaining_custodied_amount = custody_token.amount.saturating_sub(user_amount);

        // Offer price + security deposit was checked in placing the initial offer.
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

        if penalized && best_offer_token.key() != executor_token.key() {
            deposit_and_fee = deposit_and_fee.saturating_sub(penalty);
        }

        let mut beneficiary = None;

        // If the initial offer token account doesn't exist anymore, we have nowhere to send the
        // init auction fee. The executor will get these funds instead.
        if !initial_offer_token.data_is_empty() {
            // Deserialize to token account to find owner. We know this is a legitimate token
            // account, so it is safe to borrow and unwrap here.
            {
                let mut acc_data: &[_] = &initial_offer_token.data.borrow();
                let token_data = token::TokenAccount::try_deserialize(&mut acc_data).unwrap();
                require_keys_eq!(
                    token_data.owner,
                    initial_participant.key(),
                    ErrorCode::ConstraintTokenOwner
                );

                beneficiary.replace(initial_participant.to_account_info());
            }

            if best_offer_token.key() != initial_offer_token.key() {
                // Pay the auction initiator their fee.
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: custody_token.to_account_info(),
                            to: initial_offer_token.to_account_info(),
                            authority: auction.to_account_info(),
                        },
                        &[auction_signer_seeds],
                    ),
                    init_auction_fee,
                )?;

                // Because the initial offer token was paid this fee, we account for it here.
                remaining_custodied_amount =
                    remaining_custodied_amount.saturating_sub(init_auction_fee);
            } else {
                // Add it to the reimbursement.
                deposit_and_fee = deposit_and_fee
                    .checked_add(init_auction_fee)
                    .ok_or(MatchingEngineError::U64Overflow)?;
            }
        }

        // Return the security deposit and the fee to the highest bidder.
        //
        if best_offer_token.key() == executor_token.key() {
            // If the best offer token is equal to the executor token, just send whatever remains in the
            // custody token account.
            //
            // NOTE: This will revert if the best offer token does not exist. But this will present
            // an opportunity for another executor to execute this order and take what the best
            // offer token would have received.
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: custody_token.to_account_info(),
                        to: best_offer_token.to_account_info(),
                        authority: auction.to_account_info(),
                    },
                    &[auction_signer_seeds],
                ),
                remaining_custodied_amount,
            )?;
        } else {
            // Otherwise, send the deposit and fee to the best offer token. If the best offer token
            // doesn't exist at this point (which would be unusual), we will reserve these funds
            // for the executor token.
            if !best_offer_token.data_is_empty() {
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: custody_token.to_account_info(),
                            to: best_offer_token.to_account_info(),
                            authority: auction.to_account_info(),
                        },
                        &[auction_signer_seeds],
                    ),
                    deposit_and_fee,
                )?;

                remaining_custodied_amount =
                    remaining_custodied_amount.saturating_sub(deposit_and_fee);
            }

            // And pay the executor whatever remains in the auction custody token account.
            if remaining_custodied_amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: custody_token.to_account_info(),
                            to: executor_token.to_account_info(),
                            authority: auction.to_account_info(),
                        },
                        &[auction_signer_seeds],
                    ),
                    remaining_custodied_amount,
                )?;
            }
        }

        // Set the authority of the custody token account to the custodian. He will take over from
        // here.
        token::set_authority(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                token::SetAuthority {
                    current_authority: auction.to_account_info(),
                    account_or_mint: custody_token.to_account_info(),
                },
                &[auction_signer_seeds],
            ),
            token::spl_token::instruction::AuthorityType::AccountOwner,
            custodian.key().into(),
        )?;

        // Emit the order executed event, which liquidators can listen to if this execution ended up
        // being penalized so they can collect the base fee at settlement.
        emit!(crate::events::OrderExecuted {
            auction: auction.key(),
            vaa: fast_vaa.key(),
            source_chain: auction_info.source_chain,
            target_protocol: auction.target_protocol,
            penalized,
        });

        (
            user_amount,
            AuctionStatus::Completed {
                slot: current_slot,
                execute_penalty: if penalized { penalty.into() } else { None },
            },
            beneficiary,
        )
    };

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
        beneficiary,
    })
}
