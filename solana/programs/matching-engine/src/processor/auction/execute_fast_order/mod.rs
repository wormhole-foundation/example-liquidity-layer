mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionStatus, Custodian, PayerSequence},
    utils::{self, auction::DepositPenalty},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::{raw::LiquidityLayerPayload, Fill},
    wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount,
};

struct PrepareFastExecution<'ctx, 'info> {
    custodian: &'ctx AccountInfo<'info>,
    auction_config: &'ctx Account<'info, AuctionConfig>,
    fast_vaa: &'ctx AccountInfo<'info>,
    auction: &'ctx mut Box<Account<'info, Auction>>,
    cctp_mint_recipient: &'ctx AccountInfo<'info>,
    executor_token: &'ctx Account<'info, token::TokenAccount>,
    best_offer_token: &'ctx AccountInfo<'info>,
    initial_offer_token: &'ctx AccountInfo<'info>,
    payer_sequence: &'ctx mut Account<'info, PayerSequence>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct PreparedFastExecution {
    pub user_amount: u64,
    pub fill: Fill,
    pub sequence_seed: [u8; 8],
}

fn prepare_fast_execution(accounts: PrepareFastExecution) -> Result<PreparedFastExecution> {
    let PrepareFastExecution {
        custodian,
        auction_config,
        fast_vaa,
        auction,
        cctp_mint_recipient,
        executor_token,
        best_offer_token,
        initial_offer_token,
        payer_sequence,
        token_program,
    } = accounts;

    // Create zero copy reference to `FastMarketOrder` payload.
    let fast_vaa = VaaAccount::load(fast_vaa).unwrap();
    let order = LiquidityLayerPayload::try_from(fast_vaa.try_payload().unwrap())
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message()
        .to_fast_market_order_unchecked();

    let (user_amount, new_status) = {
        let auction_info = auction.info.as_ref().unwrap();

        let current_slot = Clock::get().map(|clock| clock.slot)?;
        require!(
            current_slot > auction_info.auction_end_slot(auction_config),
            MatchingEngineError::AuctionPeriodNotExpired
        );

        let DepositPenalty {
            penalty,
            user_reward,
        } = utils::auction::compute_deposit_penalty(auction_config, auction_info, current_slot);

        let mut deposit_and_fee =
            auction_info.offer_price + auction_info.security_deposit - user_reward;

        if penalty > 0 && best_offer_token.key() != executor_token.key() {
            // Pay the liquidator the penalty.
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: cctp_mint_recipient.to_account_info(),
                        to: executor_token.to_account_info(),
                        authority: custodian.to_account_info(),
                    },
                    &[Custodian::SIGNER_SEEDS],
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
                        from: cctp_mint_recipient.to_account_info(),
                        to: initial_offer_token.to_account_info(),
                        authority: custodian.to_account_info(),
                    },
                    &[Custodian::SIGNER_SEEDS],
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
                    from: cctp_mint_recipient.to_account_info(),
                    to: best_offer_token.to_account_info(),
                    authority: custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            deposit_and_fee,
        )?;

        (
            // TODO: fix this
            auction_info.amount_in - auction_info.offer_price - init_auction_fee + user_reward,
            AuctionStatus::Completed { slot: current_slot },
        )
    };

    // Set the auction status to completed.
    auction.status = new_status;

    Ok(PreparedFastExecution {
        user_amount,
        fill: Fill {
            source_chain: fast_vaa.try_emitter_chain()?,
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: <&[u8]>::from(order.redeemer_message()).to_vec().into(),
        },
        sequence_seed: payer_sequence.take_and_uptick().to_be_bytes(),
    })
}
