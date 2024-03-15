mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::state::{
    Auction, AuctionStatus, Custodian, PayerSequence, PreparedOrderResponse, RouterEndpoint,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::{
        raw::{LiquidityLayerMessage, MessageToVec},
        Fill,
    },
    wormhole_cctp_solana::wormhole::VaaAccount,
};

struct SettleNoneAndPrepareFill<'ctx, 'info> {
    custodian: &'ctx Account<'info, Custodian>,
    prepared_order_response: &'ctx Account<'info, PreparedOrderResponse>,
    fast_vaa: &'ctx AccountInfo<'info>,
    auction: &'ctx mut Account<'info, Auction>,
    from_router_endpoint: &'ctx Account<'info, RouterEndpoint>,
    to_router_endpoint: &'ctx Account<'info, RouterEndpoint>,
    fee_recipient_token: &'ctx AccountInfo<'info>,
    cctp_mint_recipient: &'ctx AccountInfo<'info>,
    payer_sequence: &'ctx mut Account<'info, PayerSequence>,
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
    auction_custody_token_bump_seed: u8,
) -> Result<SettledNone> {
    let SettleNoneAndPrepareFill {
        custodian,
        prepared_order_response,
        fast_vaa,
        auction,
        from_router_endpoint,
        to_router_endpoint,
        fee_recipient_token,
        cctp_mint_recipient,
        payer_sequence,
        token_program,
    } = accounts;

    let fast_vaa = VaaAccount::load_unchecked(fast_vaa);
    let order = LiquidityLayerMessage::try_from(fast_vaa.payload())
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
                from: cctp_mint_recipient.to_account_info(),
                to: fee_recipient_token.to_account_info(),
                authority: custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        base_fee,
    )?;

    // This is a necessary security check. This will prevent a relayer from starting an auction with
    // the fast transfer VAA, even though the slow relayer already delivered the slow VAA. Not
    // setting this could lead to trapped funds (which would require an upgrade to fix).
    auction.set_inner(Auction {
        bump: auction_bump_seed,
        vaa_hash: fast_vaa.digest().0,
        custody_token_bump: auction_custody_token_bump_seed,
        status: AuctionStatus::Settled {
            base_fee,
            penalty: None,
        },
        info: None,
    });

    Ok(SettledNone {
        user_amount: order.amount_in() - base_fee,
        fill: Fill {
            source_chain: prepared_order_response.source_chain,
            order_sender: order.sender(),
            redeemer: order.redeemer(),
            redeemer_message: order.message_to_vec().into(),
        },
        sequence_seed: payer_sequence.take_and_uptick().to_be_bytes(),
    })
}
