mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::state::{Auction, AuctionStatus, Custodian, PreparedOrderResponse, RouterEndpoint};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::{raw::LiquidityLayerMessage, Fill},
    wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount,
};

struct SettleNoneAndPrepareFill<'ctx, 'info> {
    custodian: &'ctx Account<'info, Custodian>,
    prepared_order_response: &'ctx Account<'info, PreparedOrderResponse>,
    fast_vaa: &'ctx AccountInfo<'info>,
    auction: &'ctx mut Account<'info, Auction>,
    from_router_endpoint: &'ctx Account<'info, RouterEndpoint>,
    to_router_endpoint: &'ctx Account<'info, RouterEndpoint>,
    fee_recipient_token: &'ctx AccountInfo<'info>,
    custody_token: &'ctx AccountInfo<'info>,
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
        custodian,
        prepared_order_response,
        fast_vaa,
        auction,
        from_router_endpoint,
        to_router_endpoint,
        fee_recipient_token,
        custody_token,
        token_program,
    } = accounts;

    let fast_vaa = VaaAccount::load(fast_vaa).unwrap();
    let order = LiquidityLayerMessage::try_from(fast_vaa.try_payload().unwrap())
        .unwrap()
        .to_fast_market_order_unchecked();

    // NOTE: We need to verify the router path, since an auction was never created and this check is
    // done in the `place_initial_offer` instruction.
    crate::utils::require_valid_router_path(
        &fast_vaa,
        from_router_endpoint,
        to_router_endpoint,
        order.target_chain(),
    )?;

    // Pay the `fee_recipient` the base fee. This ensures that the protocol relayer is paid for
    // relaying slow VAAs that do not have an associated auction. This prevents the protocol relayer
    // from any MEV attacks.
    let base_fee = prepared_order_response.base_fee;
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: custody_token.to_account_info(),
                to: fee_recipient_token.to_account_info(),
                authority: custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        base_fee,
    )?;

    let user_amount = order.amount_in() - base_fee;

    let mut redeemer_message = Vec::with_capacity(order.redeemer_message_len().try_into().unwrap());
    <Vec<_> as std::io::Write>::write_all(&mut redeemer_message, order.redeemer_message().into())?;

    let fill = Fill {
        source_chain: prepared_order_response.source_chain,
        order_sender: order.sender(),
        redeemer: order.redeemer(),
        redeemer_message: redeemer_message.into(),
    };

    // This is a necessary security check. This will prevent a relayer from starting an auction with
    // the fast transfer VAA, even though the slow relayer already delivered the slow VAA. Not
    // setting this could lead to trapped funds (which would require an upgrade to fix).
    auction.set_inner(Auction {
        bump: auction_bump_seed,
        vaa_hash: fast_vaa.try_digest().unwrap().0,
        status: AuctionStatus::Settled {
            base_fee,
            penalty: None,
        },
        info: None,
    });

    Ok(SettledNone { user_amount, fill })
}
