mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionStatus, Custodian},
    utils::{self, math::DepositPenalty},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::{raw::LiquidityLayerPayload, Fill};
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;

struct PrepareFastExecution<'ctx, 'info> {
    custodian: &'ctx AccountInfo<'info>,
    auction_config: &'ctx Account<'info, AuctionConfig>,
    fast_vaa: &'ctx AccountInfo<'info>,
    auction: &'ctx mut Box<Account<'info, Auction>>,
    custody_token: &'ctx AccountInfo<'info>,
    executor_token: &'ctx Account<'info, token::TokenAccount>,
    best_offer_token: &'ctx AccountInfo<'info>,
    initial_offer_token: &'ctx AccountInfo<'info>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct PreparedFastExecution {
    pub transfer_amount: u64,
    pub destination_cctp_domain: u32,
    pub fill: Fill,
}

fn prepare_fast_execution(accounts: PrepareFastExecution) -> Result<PreparedFastExecution> {
    // Create zero copy reference to `FastMarketOrder` payload.
    let fast_vaa = VaaAccount::load(accounts.fast_vaa).unwrap();
    let order = LiquidityLayerPayload::try_from(fast_vaa.try_payload().unwrap())
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message()
        .to_fast_market_order_unchecked();

    let (new_status, transfer_amount) = {
        let auction_info = accounts.auction.info.as_ref().unwrap();

        let Clock {
            slot: current_slot, ..
        } = Clock::get()?;
        require!(
            current_slot > auction_info.end_slot,
            MatchingEngineError::AuctionPeriodNotExpired
        );

        let DepositPenalty {
            penalty,
            user_reward,
        } = utils::math::compute_deposit_penalty(
            accounts.auction_config,
            auction_info,
            current_slot,
        );

        let mut reimbursement =
            auction_info.offer_price + auction_info.security_deposit - user_reward;

        if penalty > 0 && accounts.best_offer_token.key() != accounts.executor_token.key() {
            // Pay the liquidator the penalty.
            token::transfer(
                CpiContext::new_with_signer(
                    accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: accounts.custody_token.to_account_info(),
                        to: accounts.executor_token.to_account_info(),
                        authority: accounts.custodian.to_account_info(),
                    },
                    &[Custodian::SIGNER_SEEDS],
                ),
                penalty,
            )?;

            reimbursement -= penalty;
        }

        let init_auction_fee = order.init_auction_fee();
        if accounts.best_offer_token.key() != accounts.initial_offer_token.key() {
            // Pay the auction initiator their fee.
            token::transfer(
                CpiContext::new_with_signer(
                    accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: accounts.custody_token.to_account_info(),
                        to: accounts.initial_offer_token.to_account_info(),
                        authority: accounts.custodian.to_account_info(),
                    },
                    &[Custodian::SIGNER_SEEDS],
                ),
                init_auction_fee,
            )?;
        } else {
            // Add it to the reimbursement.
            reimbursement += init_auction_fee;
        }

        // Return the security deposit and the fee to the highest bidder.
        token::transfer(
            CpiContext::new_with_signer(
                accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: accounts.custody_token.to_account_info(),
                    to: accounts.best_offer_token.to_account_info(),
                    authority: accounts.custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            reimbursement,
        )?;

        (
            AuctionStatus::Completed { slot: current_slot },
            // TODO: fix this
            auction_info.amount_in - auction_info.offer_price - init_auction_fee + user_reward,
        )
    };

    // Set the auction status to completed.
    accounts.auction.status = new_status;

    Ok(PreparedFastExecution {
        transfer_amount,
        destination_cctp_domain: order.destination_cctp_domain(),
        fill: Fill {
            source_chain: fast_vaa.try_emitter_chain()?,
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: <&[u8]>::from(order.redeemer_message()).to_vec().into(),
        },
    })
}
