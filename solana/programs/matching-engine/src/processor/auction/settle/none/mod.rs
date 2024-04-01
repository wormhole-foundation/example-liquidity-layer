mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    composite::*,
    state::{Auction, AuctionStatus, PayerSequence, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::{
    raw::{LiquidityLayerMessage, MessageToVec},
    Fill,
};

struct SettleNoneAndPrepareFill<'ctx, 'info> {
    payer_sequence: &'ctx mut Account<'info, PayerSequence>,
    fast_vaa: &'ctx LiquidityLayerVaa<'info>,
    prepared_order_response: &'ctx Account<'info, PreparedOrderResponse>,
    prepared_custody_token: &'ctx AccountInfo<'info>,
    auction: &'ctx mut Account<'info, Auction>,
    fee_recipient_token: &'ctx AccountInfo<'info>,
    dst_token: &'ctx Account<'info, token::TokenAccount>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct SettledNone {
    user_amount: u64,
    fill: Fill,
    sequence_seed: [u8; 8],
}

fn settle_none_and_prepare_fill(
    accounts: SettleNoneAndPrepareFill<'_, '_>,
    auction_bump_seed: u8,
) -> Result<SettledNone> {
    let SettleNoneAndPrepareFill {
        payer_sequence,
        fast_vaa,
        prepared_order_response,
        prepared_custody_token,
        auction,
        fee_recipient_token,
        dst_token,
        token_program,
    } = accounts;

    let fast_vaa = fast_vaa.load_unchecked();
    let order = LiquidityLayerMessage::try_from(fast_vaa.payload())
        .unwrap()
        .to_fast_market_order_unchecked();

    let prepared_order_response_signer_seeds = &[
        PreparedOrderResponse::SEED_PREFIX,
        prepared_order_response.fast_vaa_hash.as_ref(),
        &[prepared_order_response.bump],
    ];

    // Pay the `fee_recipient` the base fee. This ensures that the protocol relayer is paid for
    // relaying slow VAAs that do not have an associated auction. This prevents the protocol relayer
    // from any MEV attacks.
    let base_fee = prepared_order_response.base_fee;
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: prepared_custody_token.to_account_info(),
                to: fee_recipient_token.to_account_info(),
                authority: prepared_order_response.to_account_info(),
            },
            &[prepared_order_response_signer_seeds],
        ),
        base_fee,
    )?;

    let user_amount = order.amount_in() - base_fee;
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: prepared_custody_token.to_account_info(),
                to: dst_token.to_account_info(),
                authority: prepared_order_response.to_account_info(),
            },
            &[prepared_order_response_signer_seeds],
        ),
        user_amount,
    )?;

    // This is a necessary security check. This will prevent a relayer from starting an auction with
    // the fast transfer VAA, even though the slow relayer already delivered the slow VAA. Not
    // setting this could lead to trapped funds (which would require an upgrade to fix).
    auction.set_inner(Auction {
        bump: auction_bump_seed,
        vaa_hash: fast_vaa.digest().0,
        vaa_timestamp: fast_vaa.timestamp(),
        status: AuctionStatus::Settled {
            base_fee,
            total_penalty: None,
        },
        info: None,
    });

    Ok(SettledNone {
        user_amount,
        fill: Fill {
            source_chain: prepared_order_response.source_chain,
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: order.message_to_vec().into(),
        },
        sequence_seed: payer_sequence.take_and_uptick().to_be_bytes(),
    })
}
