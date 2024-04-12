mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    composite::*,
    state::{Auction, AuctionStatus, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::{
    raw::{LiquidityLayerMessage, MessageToVec},
    Fill,
};

struct SettleNoneAndPrepareFill<'ctx, 'info> {
    fast_vaa: &'ctx LiquidityLayerVaa<'info>,
    prepared_order_response: &'ctx Account<'info, PreparedOrderResponse>,
    prepared_custody_token: &'ctx UncheckedAccount<'info>,
    auction: &'ctx mut Account<'info, Auction>,
    fee_recipient_token: &'ctx Account<'info, token::TokenAccount>,
    custodian: &'ctx CheckedCustodian<'info>,
    to_router_endpoint: &'ctx LiveRouterEndpoint<'info>,
    token_program: &'ctx Program<'info, token::Token>,
}

struct SettledNone {
    user_amount: u64,
    fill: Fill,
}

fn settle_none_and_prepare_fill(
    accounts: SettleNoneAndPrepareFill<'_, '_>,
    auction_bump_seed: u8,
) -> Result<SettledNone> {
    let SettleNoneAndPrepareFill {
        fast_vaa,
        prepared_order_response,
        prepared_custody_token,
        auction,
        fee_recipient_token,
        custodian,
        to_router_endpoint,
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

    // Pay the `fee_recipient` the base fee and init auction fee. This ensures that the protocol
    // relayer is paid for relaying slow VAAs (which requires posting the fast order VAA) that do
    // not have an associated auction.
    let fee = prepared_order_response
        .base_fee
        .saturating_add(order.init_auction_fee());
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
        fee,
    )?;

    // Set the authority of the custody token account to the custodian. He will take over from here.
    token::set_authority(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::SetAuthority {
                current_authority: prepared_order_response.to_account_info(),
                account_or_mint: prepared_custody_token.to_account_info(),
            },
            &[prepared_order_response_signer_seeds],
        ),
        token::spl_token::instruction::AuthorityType::AccountOwner,
        Some(custodian.key()),
    )?;

    // This is a necessary security check. This will prevent a relayer from starting an auction with
    // the fast transfer VAA, even though the slow relayer already delivered the slow VAA. Not
    // setting this could lead to trapped funds (which would require an upgrade to fix).
    auction.set_inner(Auction {
        bump: auction_bump_seed,
        vaa_hash: fast_vaa.digest().0,
        vaa_timestamp: fast_vaa.timestamp(),
        target_protocol: to_router_endpoint.protocol,
        status: AuctionStatus::Settled {
            fee,
            total_penalty: None,
        },
        info: None,
    });

    emit!(crate::events::AuctionSettled {
        auction: auction.key(),
        best_offer_token: Default::default(),
        token_balance_after: fee_recipient_token.amount.saturating_add(fee),
    });

    Ok(SettledNone {
        user_amount: order.amount_in().saturating_sub(fee),
        fill: Fill {
            source_chain: prepared_order_response.source_chain,
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: order.message_to_vec().into(),
        },
    })
}
