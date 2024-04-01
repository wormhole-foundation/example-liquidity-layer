mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, PayerSequence},
    utils::{self, auction::DepositPenalty},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::{raw::LiquidityLayerPayload, Fill};

struct PrepareFastExecution<'ctx, 'info> {
    execute_order: &'ctx mut ExecuteOrder<'info>,
    payer_sequence: &'ctx mut Account<'info, PayerSequence>,
    dst_token: &'ctx Account<'info, token::TokenAccount>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct PreparedOrderExecution {
    pub user_amount: u64,
    pub fill: Fill,
    pub sequence_seed: [u8; 8],
}

fn prepare_order_execution(accounts: PrepareFastExecution) -> Result<PreparedOrderExecution> {
    let PrepareFastExecution {
        execute_order,
        payer_sequence,
        dst_token,
        token_program,
    } = accounts;

    let ExecuteOrder {
        fast_vaa,
        active_auction,
        executor_token,
        initial_offer_token,
    } = execute_order;

    let fast_vaa = fast_vaa.load_unchecked();
    let order = LiquidityLayerPayload::try_from(fast_vaa.payload())
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message()
        .to_fast_market_order_unchecked();

    let ActiveAuction {
        auction,
        custody_token,
        config,
        best_offer_token,
    } = active_auction;

    // Create zero copy reference to `FastMarketOrder` payload.

    let (user_amount, new_status) = {
        let auction_info = auction.info.as_ref().unwrap();

        let current_slot = Clock::get().unwrap().slot;
        require!(
            current_slot > auction_info.auction_end_slot(config),
            MatchingEngineError::AuctionPeriodNotExpired
        );

        let DepositPenalty {
            penalty,
            user_reward,
        } = utils::auction::compute_deposit_penalty(config, auction_info, current_slot);

        let mut deposit_and_fee =
            auction_info.offer_price + auction_info.security_deposit - user_reward;

        let auction_signer_seeds = &[
            Auction::SEED_PREFIX,
            auction.vaa_hash.as_ref(),
            &[auction.bump],
        ];

        if penalty > 0 && best_offer_token.key() != executor_token.key() {
            // Pay the liquidator the penalty.
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
                penalty,
            )?;

            deposit_and_fee -= penalty;
        }

        let init_auction_fee = order.init_auction_fee();
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
        } else {
            // Add it to the reimbursement.
            deposit_and_fee += init_auction_fee;
        }

        // Return the security deposit and the fee to the highest bidder.
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

        // Transfer funds to local custody token account.
        let user_amount =
            auction_info.amount_in - auction_info.offer_price - init_auction_fee + user_reward;
        token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                token::Transfer {
                    from: custody_token.to_account_info(),
                    to: dst_token.to_account_info(),
                    authority: auction.to_account_info(),
                },
                &[auction_signer_seeds],
            ),
            user_amount,
        )?;

        (
            user_amount,
            AuctionStatus::Completed {
                slot: current_slot,
                execute_penalty: if penalty > 0 { Some(penalty) } else { None },
            },
        )
    };

    // Set the auction status to completed.
    auction.status = new_status;

    Ok(PreparedOrderExecution {
        user_amount,
        fill: Fill {
            source_chain: fast_vaa.emitter_chain(),
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: <&[u8]>::from(order.redeemer_message()).to_vec().into(),
        },
        sequence_seed: payer_sequence.take_and_uptick().to_be_bytes(),
    })
}
