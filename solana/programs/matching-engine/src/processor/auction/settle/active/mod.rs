mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    state::{Auction, AuctionConfig, AuctionStatus, Custodian, PreparedOrderResponse},
    utils::{self, auction::DepositPenalty},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::{
    raw::{FastMarketOrder, LiquidityLayerMessage},
    Fill,
};
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;

struct SettleActiveAndPrepareFill<'ctx, 'info> {
    custodian: &'ctx AccountInfo<'info>,
    auction_config: &'ctx Account<'info, AuctionConfig>,
    prepared_order_response: &'ctx Account<'info, PreparedOrderResponse>,
    executor_token: &'ctx Account<'info, token::TokenAccount>,
    best_offer_token: &'ctx AccountInfo<'info>,
    custody_token: &'ctx AccountInfo<'info>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct SettledActive<'ctx> {
    order: FastMarketOrder<'ctx>,
    user_amount: u64,
    fill: Fill,
}

fn settle_active_and_prepare_fill<'ctx>(
    accounts: SettleActiveAndPrepareFill<'ctx, '_>,
    fast_vaa: &'ctx VaaAccount<'ctx>,
    auction: &'ctx mut Auction,
) -> Result<SettledActive<'ctx>> {
    let SettleActiveAndPrepareFill {
        custodian,
        auction_config,
        prepared_order_response,
        executor_token,
        best_offer_token,
        custody_token,
        token_program,
    } = accounts;

    let order = LiquidityLayerMessage::try_from(fast_vaa.try_payload().unwrap())
        .unwrap()
        .to_fast_market_order_unchecked();

    // This means the slow message beat the fast message. We need to refund the bidder and
    // (potentially) take a penalty for not fulfilling their obligation. The `penalty` CAN be zero
    // in this case, since the auction grace period might not have ended yet.
    let (liquidator_amount, mut best_offer_amount, user_amount, final_status) = {
        let auction_info = auction.info.as_ref().unwrap();

        let DepositPenalty {
            penalty,
            user_reward,
        } = utils::auction::compute_deposit_penalty(
            auction_config,
            auction.info.as_ref().unwrap(),
            Clock::get().map(|clock| clock.slot)?,
        );

        // TODO: do math to adjust base fee and reward by amount_out / amount_in.
        let base_fee = accounts.prepared_order_response.base_fee;

        // NOTE: The sum of all amounts should be 2 * amount_in + security_deposit.
        // * amount_in + security_deposit comes from the auction participation.
        // * amount_in comes from the inbound transfer.
        (
            penalty + base_fee,
            auction_info.amount_in + auction_info.security_deposit - penalty - user_reward,
            auction_info.amount_in + user_reward - base_fee,
            AuctionStatus::Settled {
                base_fee,
                penalty: Some(penalty),
            },
        )
    };

    if executor_token.key() != best_offer_token.key() {
        // Transfer the penalty amount to the caller. The caller also earns the base fee for relaying
        // the slow VAA.
        token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                token::Transfer {
                    from: custody_token.to_account_info(),
                    to: executor_token.to_account_info(),
                    authority: custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            liquidator_amount,
        )?;
    } else {
        best_offer_amount += liquidator_amount;
    }

    // Transfer to the best offer token what he deserves.
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: custody_token.to_account_info(),
                to: best_offer_token.to_account_info(),
                authority: custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        best_offer_amount,
    )?;

    let mut redeemer_message = Vec::with_capacity(order.redeemer_message_len().try_into().unwrap());
    <Vec<_> as std::io::Write>::write_all(&mut redeemer_message, order.redeemer_message().into())?;

    let fill = Fill {
        source_chain: prepared_order_response.source_chain,
        order_sender: order.sender(),
        redeemer: order.redeemer(),
        redeemer_message: redeemer_message.into(),
    };

    // Everyone's whole, set the auction as completed.
    auction.status = final_status;

    Ok(SettledActive {
        order,
        user_amount,
        fill,
    })
}
